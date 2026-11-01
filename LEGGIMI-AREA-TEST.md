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

## Generazione turni e portale richieste (solo area test)

Nell'Area coordinatore c'è un gruppo **Area test** con due sezioni nuove:

- **Generazione turni** (`generatore-turni.js`): sceglie l'anno (es. 2027), parte dai
  turni già compilati nel calendario (gennaio 2027 compreso) e riempie il resto seguendo
  le regole scritte nella stessa finestra, ognuna attivabile o disattivabile:
  equità fra operatori, equità reperibilità, modello diurnisti 7h12 (2 riposi) o 6h
  (1 riposo), riposi nel weekend, mattina prima / pomeriggio dopo il riposo, rotazione
  turno ↔ diurno ogni 5 settimane, reperibilità non ravvicinate, festivi equi,
  2 autisti di mattina e pomeriggio e 1 o 2 di notte, 36 h settimanali.
  Il piano si salva solo nel Firebase finto (`test_generatore/<anno>`): il calendario
  dell'app non viene toccato. Gestione operatori presente ma bloccata.
- **Richieste dal portale**: le richieste mandate da `portale-richieste.html` (copia
  finta del portale Richieste A.S. 118) arrivano qui. "In automatico" segna l'assenza
  e trova chi la copre; nel calendario generato compare "copertura turno di …".
  "Inserisci manualmente" segna solo l'assenza; i turni scoperti si sistemano toccando
  la casella.
