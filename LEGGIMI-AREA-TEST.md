# AREA TEST — Turni autisti scollegati da Firebase

Questa è una copia di **PROVA-MODIFICHE-TURNI** fatta per le prove "pericolose".
Grafica e funzioni sono le stesse, ma **non c'è nessun collegamento a Firebase**:

- `firebase-mock.js` prende il posto delle librerie Firebase. Fa le stesse cose
  (leggere, salvare, ascoltare i cambiamenti, accesso anonimo) ma i dati restano
  **solo nel browser** di chi usa l'app (localStorage, chiavi `TESTFB:`).
- `area-test.js` tiene la memoria del dispositivo separata dalle app vere
  (prefisso `test26_`) e disegna la **bandella bianca e rossa "AREA TEST"**.
  Toccando la scritta in alto si possono azzerare tutti i dati di prova.
- Il motore delle notifiche (`.github/`) **non è stato copiato**: da qui non parte
  nessuna notifica vera ai telefoni.
- Restano solo letture di file pubblici (l'Excel ufficiale degli autisti,
  l'Excel infermieri, la lista dei commit su GitHub): non modificano nulla.

All'inizio il database finto è vuoto: i turni arrivano dall'Excel come nell'app di prova.

Dalla console del browser:
`__testFirebase.dump()` mostra i dati finti, `__testFirebase.reset()` li cancella,
`__testFirebase.importJSON({...})` ne carica di nuovi.

Copia fatta da PROVA-MODIFICHE-TURNI al commit `dc027e2`.
