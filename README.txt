SYMULATOR POLITYCZNY — jak uruchomić na swoim komputerze
==========================================================

Wymagania (jednorazowo):
1. Zainstaluj Node.js (wersja LTS) ze strony: https://nodejs.org
   (podczas instalacji można zostawić wszystkie opcje domyślne)

Uruchomienie gry:
- Windows: kliknij dwukrotnie plik  uruchom-gre.bat
- Mac:     kliknij dwukrotnie plik  uruchom-gre.command
           (jeśli system zablokuje uruchomienie: kliknij prawym
           przyciskiem -> Otwórz, albo w Ustawieniach systemowych
           -> Prywatność i bezpieczeństwo zezwól na uruchomienie)
- Linux:   otwórz terminal w tym folderze i wpisz: ./uruchom-gre.command

Za pierwszym razem skrypt zainstaluje potrzebne paczki (może to potrwać
minutę-dwie), a potem automatycznie otworzy grę w przeglądarce pod adresem
http://localhost:5173

Kolejne uruchomienia będą już dużo szybsze — po prostu odpalasz ten sam plik.

Żeby zatrzymać grę, zamknij okno konsoli/terminala, które się otworzyło.

ZAPISY GRY
==========
Gra zapisuje stan automatycznie w przeglądarce (autosave) — wystarczy ją
zamknąć i wrócić później, ekran startowy zaproponuje "Kontynuuj ostatnią grę".
W zakładce "Ustawienia" można też:
- zapisać grę pod własną nazwą (kilka zapisów jednocześnie),
- wyeksportować zapis do pliku .json (np. żeby przenieść go na inny komputer),
- wczytać zapis z pliku .json.

Uwaga: autosave i nazwane zapisy są przechowywane w pamięci przeglądarki
(localStorage) — czyszczenie danych przeglądarki/historii je usunie.
Ważne postępy w grze warto od czasu do czasu wyeksportować do pliku.
