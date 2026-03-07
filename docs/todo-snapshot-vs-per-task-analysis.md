# Todo: snapshot vs osobne rekordy (per-task) – analiza

## Obecny model: snapshot

- **Tabela:** `todo_snapshots` — jeden wiersz na parę `(user_id, date)`.
- **Payload:** jeden JSONB z pełną listą: `TodoListOutput` (listId, userId, date, generatedAt, updatedBecause, **items[]**, stats, version).
- **Odczyt:** pobranie snapshotu dla daty → parsowanie `payload` → zwrot listy zadań.
- **Modyfikacje (update/delete/move):** odczyt całego snapshotu → zmiana w pamięci → `upsert` całego payloadu.

---

## Zalety snapshotu (dlaczego obecnie ma sens)

1. **Spójność „listy na dzień”**  
   Lista na dany dzień jest generowana w jednym przebiegu (LLM + integracje). Snapshot = dokładnie ten wynik w jednym miejscu. Brak ryzyka „rozjechania się” listy (część z generacji, część z ręcznych edycji w inny sposób).

2. **Prosty model generacji**  
   Generator zwraca `TodoListOutput` i od razu go zapisuje. Nie ma mapowania „N zadań → N insertów”, deduplikacji po `externalId` ani rozstrzygania, które rekordy z bazy nadal są aktualne.

3. **Historia po dacie**  
   `GET /api/integrations/todos/history` to po prostu paginacja po `todo_snapshots` (po dacie/created_at). Jedna encja = jeden dzień; łatwo „pokazać listę taką, jak była wczoraj”.

4. **Triage i Gmail reply resolver**  
   Triage porównuje nowe zadania z `existingItemKeys` z aktualnego snapshotu. Gmail resolver szuka w snapshotach po `threadId` i aktualizuje status w ramach tego samego payloadu. Wszystko opiera się na „obecnym stanie listy na dzień” — snapshot to dokładnie ten stan.

5. **Mało zapytań przy odczycie**  
   Lista na dzień = jedno `SELECT` po `(user_id, date)`. Overdue = jeden `SELECT` po `user_id` i zestawie dat.

---

## Wady snapshotu

1. **Każda edycja = pełny odczyt + pełny zapis**  
   Zmiana statusu jednego taska → `getSnapshotForDate` → zmiana jednego elementu w `items` → `upsertSnapshot` z całym JSONB. Przy większej liczbie zadań i częstych edycjach to więcej danych i potencjalnie konflikty przy równoległych zapisach (last-write-wins bez wersjonowania).

2. **Realtime tylko na poziomie wiersza**  
   `todo_snapshots` jest w Realtime; zmiana dowolnego pola wiersza (w tym `payload`) powoduje event. Subskrybent i tak dostaje całą listę (bo payload to cała lista). Brak eventów w stylu „zmienił się tylko task X”.

3. **Brak indeksów na pola zadań**  
   Nie da się w SQL zrobić np. `WHERE user_id = ? AND payload->'items' @> '[{"status":"open"}]'` w sensowny sposób. Filtrowanie po statusie/providerze/tytule zawsze po stronie aplikacji po sparsowaniu payloadu.

4. **Duży payload**  
   Wszystkie zadania na dzień w jednym JSONB; przy dziesiątkach zadań i bogatym `sourceRef` / tagach rozmiar rośnie.

---

## Model alternatywny: osobny rekord na task

- **Tabela:** np. `todo_items`: `id`, `user_id`, `date` (lub `due_date`), `snapshot_id` (opcjonalnie), kolumny skalarne lub jeden JSONB na pojedynczy `TodoItem`.
- **Lista na dzień:** `SELECT * FROM todo_items WHERE user_id = ? AND date = ?`.
- **Update/delete/move:** `UPDATE` / `DELETE` jednego wiersza; move = `UPDATE date` (ew. `due_at`).

### Zalety per-task

- **Mniejsze zapisy:** aktualizacja statusu = jeden `UPDATE` jednego wiersza.
- **Realtime:** można subskrybować `todo_items` i reagować na zmiany pojedynczych zadań (np. optymistyczne UI bez przeładowywania całej listy).
- **Indeksy:** możliwość indeksów na `(user_id, date, status)`, `(user_id, source_provider)` itd. — zapytania typu „wszystkie otwarte na dziś” w SQL.
- **Audit:** `updated_at` (i ewentualnie `created_at`) na poziomie zadania; łatwiej „kto kiedy zmienił ten task” jeśli dołożysz audit log.

### Wady / wyzwania per-task

1. **Generacja**  
   Generator zwraca jedną listę. Trzeba:
   - zmapować wynik na insert/update wielu wierszy,
   - zdecydować, jak łączyć z istniejącymi (np. po `sourceRef.externalId`): które usuwać, które aktualizować, które dodawać.
     To już robi triage (deduplikacja), ale dziś wynik ląduje w jednym snapshotcie; przy per-task trzeba by spójnej polityki „merge z już zapisanymi zadaniami na ten dzień”.

2. **„Lista na dzień” jako całość**  
   Koncepcja „wygenerowana lista na 2026-03-07” rozmywa się: lista = wynik zapytania w danym momencie. Regeneracja = usunięcie/aktualizacja wielu wierszy i wstawienie nowych. Trzeba jasno zdefiniować, czy przy regeneracji usuwamy wszystkie zadania na ten dzień i wstawiamy nowe, czy mergujemy (wtedy logika jak w triage).

3. **Historia**  
   Obecna „historia snapshotów” (lista stanów listy po dacie) wymaga albo:
   - dalszego trzymania snapshotów (np. jako materialized view / kopie w momencie generacji), albo
   - innego modelu historii (np. zdarzenia „list generated” + snapshot payload w osobnym storage).

4. **Triage i Gmail resolver**  
   Zamiast „pobierz snapshot → zmodyfikuj items → zapisz snapshot” trzeba:
   - w triage: czytać istniejące wiersze (np. po `user_id`, `date`) i budować `existingItemKeys`;
   - w Gmail resolverze: szukać `todo_items` po `user_id` + `sourceRef->threadId`, aktualizować jeden wiersz (status/done).

5. **Transakcje**  
   Regeneracja = wiele INSERT/UPDATE/DELETE. Potrzebna spójna transakcja, żeby nie zostawić „pół listy” przy błędzie.

---

## Rekomendacja

- **Na teraz: zostać przy snapshotach** — model jest spójny z „listą na dzień”, generacją jednym kawałkiem, triage i Gmail resolverem. Koszt to głównie pełny odczyt/zapis przy edycji; przy typowej liczbie zadań na dzień jest to akceptowalne.
- **Per-task rozważyć**, gdy:
  - będzie potrzeba **realtime na poziomie pojedynczego zadania** (np. wiele kart/tabów, współedycja),
  - **zapytania** po statusie/providerze/dacie będą częste i mają być po stronie bazy (indeksy),
  - **audit** na poziomie pojedynczego taska stanie się wymaganiem.

Jeśli kiedyś przejść na per-task, sensowna ścieżka to:

- wprowadzić tabelę `todo_items` z `user_id`, `date`, payloadem pojedynczego `TodoItem` (lub kolumny z payloadu),
- generację nadal robić do struktury w pamięci, a potem „zapisać listę” jako: transakcja usunięcia starych zadań na ten dzień + insert nowych (albo merge po kluczach jak w triage),
- zachować opcjonalnie `todo_snapshots` z zredukowanym payloadem (np. tylko metadata: listId, date, generatedAt, stats) do historii „jak wyglądała lista po generacji”,
- w Gmail resolverze i triage przełączyć się na odczyt/zapis `todo_items` zamiast snapshotu.

Podsumowując: **snapshot jest dobrym rozwiązaniem** dla obecnego flow (generacja listy na dzień, edycje pojedynczych pozycji, historia po dacie). **Osobne rekordy** mają sens jako ewolucja, gdy pojawią się wymagania na fine-grained realtime, indeksy na zadaniach lub audit na poziomie taska.
