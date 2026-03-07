# Plan: globalny real-time (Supabase) — zaktualizowany

Jedno źródło prawdy: **jeden moduł/plik (lub mały zestaw plików) obsługuje cały real-time**. Pozostałe miejsca w aplikacji tylko **odwołują się** do tego modułu i rejestrują subskrypcje na konkretne tabele/rekordy.

---

## 1. Cele systemu (explicit)

System real-time ma zapewnić:

- **Natychmiastową synchronizację** danych między backendem a frontendem.
- **Aktualizację UI** po każdej zmianie w bazie, bez przeładowania strony.
- **Spójność danych** między wieloma urządzeniami i sesjami użytkownika.
- **Obsługę zmian z wielu źródeł**:
  - działania **użytkownika** w UI,
  - **AI agentów** (np. generowanie zadań, podsumowań),
  - **integracje zewnętrzne** (np. Composio → kalendarz, maile),
  - **procesy backendowe** (cron, webhooki, API).

Źródło: założenia z dokumentu „Realtime Updates — General Assumptions” (pkt 1, 6).

---

## 2. Jedno globalne źródło real-time

**Zasada:** cała logika subskrypcji Supabase Realtime jest w **jednym miejscu**. Komponenty i hooki **nie** tworzą własnych kanałów ani `channel().on(...)` — tylko **rejestrują się** w globalnym module po konkretne tabele/filtry i dostają eventy lub zaktualizowany stan.

### Proponowana struktura plików

| Plik                                                         | Odpowiedzialność                                                                                                                                                                                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/realtime/supabase-realtime.ts`                          | Konfiguracja: które tabele są w publikacji, typy eventów. Ewentualnie stałe (nazwy tabel, eventy).                                                                                                                                          |
| `lib/realtime/supabase-realtime-provider.tsx`                | Jeden provider (client): pobiera `userId`, zakłada **jeden** kanał, subskrybuje wybrane tabele z filtrem `user_id=eq.<userId>`, przekazuje eventy do wewnętrznego store/contextu.                                                           |
| `lib/realtime/use-realtime-table.ts` (lub `use-realtime.ts`) | Hook: „subskrybuj zmiany tabeli X (opcjonalnie z filtrem)”. Zwraca albo **wersję invalidacji** (do refetch), albo **stream eventów** (INSERT/UPDATE/DELETE + payload). Komponenty używają **tylko tego hooka** — nie bezpośrednio Supabase. |
| `lib/realtime/index.ts`                                      | Re-eksport: `SupabaseRealtimeProvider`, `useRealtimeTable`, ewentualnie typy.                                                                                                                                                               |

W poszczególnych plikach (np. `home-content.tsx`, przyszły widok kalendarza):

- **Nie** importują `createClient` ani `channel().on(...)` do real-time.
- Importują `useRealtimeTable('activity_atoms')` / `useRealtimeTable('todo_snapshots')` (albo konkretny hook typu `useRealtimeCalendar()`) i na tej podstawie albo refetchują dane (wersja), albo aktualizują stan po payloadzie (wariant „tylko zmienione elementy”).

---

## 3. Subskrypcja tylko dla użytkownika

- Wszystkie subskrypcje **filtrowane po `user_id`** (z `auth.getUser()`).
- W przyszłości: możliwość rozszerzenia o `workspace_id` / `organization_id` / `tenant_id` w tym samym module real-time, bez zmiany API w komponentach.

---

## 4. Dwa warianty aktualizacji UI

### Wariant A: invalidacja + refetch (prostszy, w planie od początku)

- Globalny provider przy każdym evencie z danej tabeli **bumpuje wersję** (np. `calendarVersion`, `tasksVersion`).
- Komponent w `useEffect([..., tableVersion])` wywołuje **refetch** (np. ten sam fetch co przy initial load).
- **Plus:** prostota, mniej logiki. **Minus:** pełne ponowne pobranie zestawu (np. cały dzień).

### Wariant B: aktualizacja tylko zmienionych elementów (rozszerzenie)

- Provider przekazuje do hooka **pełny payload** Realtime: `eventType` (INSERT | UPDATE | DELETE) oraz `payload.new` / `payload.old` (rekordy).
- Hook np. `useRealtimeTable('activity_atoms')` zwraca nie tylko wersję, ale i **ostatni event** (opcjonalnie): `{ eventType, new: Row | null, old: Row | null }`.
- Komponent:
  - przy **INSERT**: dopisuje `payload.new` do lokalnej listy (np. `setEvents(prev => [...prev, payload.new])`;
  - przy **UPDATE**: zamienia rekord po id (`payload.old.id` / `payload.new.id`);
  - przy **DELETE**: usuwa rekord po `payload.old.id`.
- **Plus:** mniej ruchu, szybsza reakcja UI, zgodne z zaleceniem „aktualizować tylko zmienione elementy”. **Minus:** trzeba mapować payload na typy aplikacji i obsłużyć edge case’y (np. filtr po dacie — rekord z innego dnia ignorować).

**Rekomendacja:** zaimplementować najpierw **Wariant A** w jednym globalnym module; **Wariant B** dodać w tym samym module jako opcję (np. `useRealtimeTable(table, { mode: 'invalidate' | 'payload' }`), żeby poszczególne miejsca mogły wybrać „refetch” albo „merge z payload”.

---

## 5. Architektura zdarzeń (przepływ)

```
Zmiana w DB (user / AI / integracja / backend)
  → Supabase Realtime (postgres_changes)
  → jeden kanał w SupabaseRealtimeProvider (filter: user_id)
  → wewnętrzny dispatcher / state (wersje lub ostatni payload)
  → useRealtimeTable('nazwa_tabeli') w komponentach
  → albo bump wersji → refetch (Wariant A),
  → albo merge payload.new/old w state (Wariant B)
  → aktualizacja UI
```

---

## 6. Konkretne kroki implementacji

1. **Supabase:** włączyć Realtime dla tabel (Dashboard lub migracja): `activity_atoms`, `todo_snapshots`.
2. **Dodać pliki** w `lib/realtime/`:
   - `supabase-realtime-provider.tsx` — jeden kanał, subskrypcje po `user_id`, przekazanie eventów do context/store.
   - `use-realtime-table.ts` — hook przyjmujący nazwę tabeli (i opcjonalnie opcje: tryb invalidate vs payload). Zwraca albo `{ version }`, albo `{ version, lastEvent }`.
   - `index.ts` — re-eksport.
3. **Provider** zamontować w layoutcie (np. `AppLayout`), tak aby był jeden na całą aplikację i miał dostęp do `userId`.
4. **W komponentach** (np. `home-content.tsx`): usunąć ewentualną bezpośrednią subskrypcję Supabase; użyć wyłącznie `useRealtimeTable('activity_atoms')` i `useRealtimeTable('todo_snapshots')` do refetchu (Wariant A) lub merge (Wariant B).
5. **Opcjonalnie:** w tym samym module dodać obsługę Wariantu B (przekazywanie payload.new/old, typy dla tabel) i udokumentować w JSDoc, kiedy używać którego wariantu.

---

## 7. Podsumowanie

- **Cele i źródła zmian** są wpisane explicite (pkt 1 powyżej).
- **Jedno źródło:** cała obsługa real-time w `lib/realtime/`; w pozostałych plikach tylko odwołania przez `useRealtimeTable(...)` (konkretne tabele/rekordy).
- **Dwa warianty:** invalidacja + refetch (A) oraz aktualizacja tylko zmienionych elementów z payload.new/old (B) — oba w tym samym module, wybór per subskrypcja/hook.
