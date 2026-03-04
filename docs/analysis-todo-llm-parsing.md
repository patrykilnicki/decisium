# Analiza: parsowanie odpowiedzi LLM w todo-generator

## Pytanie

Czy usuwanie (stripowanie) fragmentów odpowiedzi LLM przed parsowaniem JSON ma sens i jest dobrą praktyką?

## Krótka odpowiedź

**Nie.** Agresywne stripowanie bloków typu `> { thought ... }` jest ryzykowne i może usuwać prawdziwy JSON. Zalecana praktyka to **natywny structured output** (provider enforce schema) lub **minimalne parsowanie** (wyciągnij JSON bez usuwania niczego).

---

## 1. Best practices (web search, LangChain, OpenAI docs)

### Z dokumentacji i artykułów

- **OpenAI Structured Outputs**: 100% compliance ze schematem vs ~40% przy samym promptowaniu
- **LangChain**: `model.withStructuredOutput(schema)` – provider strategy gdy model wspiera, tool strategy jako fallback
- **OpenRouter**: wspiera `response_format: { type: "json_schema", json_schema: {...} }` – GPT-4o, Gemini, Claude itd.
- **Parsowanie tekstu**: „Multi-stage pipeline” – strip code fences (```) i prefatory text, NIE własnych bloków reasoning
- **Strip reasoning**: NIE jest standardową praktyką; ryzykowne gdy model może umieścić JSON wewnątrz bloku

### Skąd bloki `> { thought }`?

- **o1/o3** (OpenAI reasoning): używają _wewnętrznego_ reasoningu, nie w formacie `> { thought }` w zwykłym content
- Może pochodzić z custom promptów, fine-tunów lub modeli open-source z chain-of-thought
- Stripowanie oparte na regex może łatwo **usunąć prawdziwy JSON**, gdy jest wewnątrz bloku (non-greedy `[\s\S]*?` dopasowuje do pierwszego `}`, którym może być `}` z obiektu w JSON)

---

## 2. Composio Gmail – stan projektu

### Flow

- `fetchGmailSignals(userId, date)` → `fetchGmailEmailsFull` (Composio `GMAIL_FETCH_EMAILS` z query `after:YYYY/MM/DD`)
- Każdy sygnał ma: `messageId`, `threadId`, `subject`, `sender`, `snippet`, `threadContext`
- Log z 2026-03-04: **73 sygnały** (2 calendar, 71 email) – dane są

### Composio docs (Gmail)

- `verbose: false` może pomóc przy pustych message arrays
- Message IDs: 15–16 znaków hex (nie UUID, nie thread ID)
- `threadId` używany m.in. do linku Gmail web: `#inbox/{threadId}`

**Wniosek**: Gmail fetch działa poprawnie. Problem leży w parsowaniu odpowiedzi LLM.

---

## 3. Obecna implementacja (problemy)

```ts
// stripReasoningFromResponse – 3 regexy
out = out.replace(/\s*>\s*\{\s*thought(?:[^[\]]|[\r\n])*?\}\s*/gi, " ");
out = out.replace(/\s*\{\s*thought\s*\}\s*/gi, " ");
out = out.replace(/^\s*[a-zA-Z0-9_-]+\s*\n?/, "").trim();

// Parsowanie: text.match(/\[[\s\S]*\]/) – jedna tablica, potem fix: najdłuższa
```

### Co może pójść źle

1. **Model zwraca JSON w bloku thought**: `> { thought\n[ {...} ]\n}` – po strip mógł zostać uszkodzony tekst
2. **Model zwraca `[]` + rzeczywistą tablicę**: np. `> { thought } [] [ {...} ]` – wybór najdłuższej tablicy to dobra heurystyka
3. **Model zwraca tylko `[]`**: może to być świadoma decyzja LLM (np. „brak akcji”) lub efekt stripowania, które usunęło prawdziwą tablicę

---

## 4. Rekomendacje

### Opcja A (preferowana): Structured output

- Użyć `llm.withStructuredOutput(TaskArraySchema)` (Zod)
- OpenRouter przekazuje `response_format` do providera – model generuje JSON zgodny ze schematem
- **Efekt**: brak potrzeby stripowania i regexów, stabilne działanie

### Opcja B: Minimalne parsowanie (bez strip)

- Usunąć `stripReasoningFromResponse` całkowicie
- Pozostać przy: `text.match(/\[[\s\S]*\]/g)` + wybór najdłuższej tablicy
- Wzmocnić prompt: „Return ONLY a JSON array. No markdown, no explanation, no reasoning blocks.”
- **Efekt**: mniej ryzyka usunięcia istotnego JSON

### Opcja C: Zachować strip, ale bardzo ostrożnie

- Stripować tylko puste bloki: `> { thought }` (bez treści)
- NIE stripować bloków zawierających `[` lub `]`
- **Efekt**: częściowa ochrona przed błędami, ale nadal złożony regex

---

## 5. Rekomendowana implementacja

1. **Implementować Opcję A** – `withStructuredOutput` z Zod schema tablicy tasków
2. **Fallback na Opcję B** – gdy structured output nie jest dostępny (np. inny model przez OpenRouter)
3. **Usunąć** `stripReasoningFromResponse` – nie stripować odpowiedzi LLM
4. **Zachować** wybór najdłuższej tablicy jako fallback przy parsowaniu tekstu

---

## 6. Obsługa różnych modeli (Gemini, Claude, GPT-4o, etc.)

Projekt używa **OpenRouter** (`baseURL: https://openrouter.ai/api/v1`), więc `LLM_MODEL` może wskazywać dowolny model z ich listy.

### Structured output (ścieżka preferowana)

Gdy model wspiera `response_format: { type: "json_schema" }`:

- **Google Gemini** – wspierane
- **Anthropic Claude** (Sonnet 4.5, Opus 4.1 i nowsze) – wspierane
- **OpenAI GPT-4o** (i nowsze) – wspierane
- **Fireworks** – wspierane
- Większość modeli open-source przez OpenRouter

Lista modeli: [OpenRouter – supported_parameters=structured_outputs](https://openrouter.ai/models?order=newest&supported_parameters=structured_outputs)

### Fallback (ekstrakcja JSON z tekstu)

Gdy structured output zwróci błąd (model go nie wspiera lub inny problem), używana jest ścieżka fallback:

- Raw `llm.invoke()` + `extractJsonArrayFromResponse()` (najdłuższa tablica `[...]`)
- Działa z dowolnym modelem zwracającym JSON w odpowiedzi

---

## Źródła

- [OpenAI Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)
- [OpenRouter Structured Outputs](https://openrouter.ai/docs/features/structured-outputs)
- [LangChain Structured Output](https://docs.langchain.com/oss/javascript/langchain/structured-output)
- [LangChain Models – Structured output](https://docs.langchain.com/oss/javascript/langchain/models#structured-output)
- [Composio Gmail Tools](https://docs.composio.dev/tools/gmail)
- [LLM Output Parsing Best Practices (Reintech)](https://reintech.io/blog/llm-output-parsing-structured-data-extraction-best-practices)
- [Stop Parsing JSON with Regex (DEV)](https://dev.to/pockit_tools/llm-structured-output-in-2026-stop-parsing-json-with-regex-and-do-it-right-34pk)
