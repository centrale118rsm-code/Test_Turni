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
  Il piano si salva nel Firebase finto (`test_generatore/<anno>`) e viene scritto anche
  dove l'app tiene gli anni (`turni_<anno>-MM` e `anno_<anno>`). Da menu › Anno si sceglie
  l'anno su cui lavorare: il 2027 generato si apre come anno normale, modificabile
  (la barra arancione riporta al 2026). La prima volta i turni passano da turni.xlsx al
  Firebase finto, come a capodanno. Le caselle cambiate a mano restano anche se si rigenera.
  Orari dei diurnisti nel calendario secondo il modello: 6h 07–13 / 13–19,
  7h12 06:30–13:42 / 13:15–20:27. Operatori: si aggiungono (inizio, durata in settimane
  o mesi, affiancamento prima di turni e reperibilità) e si tolgono da una data;
  i turni vengono rigenerati da quel giorno in poi. Gli operatori aggiunti (qui o dal menu
  rapido) compaiono come colonne nel calendario dell'anno generato; la lista operatori
  dell'app non cambia. Regola ferie: massimo 2 insieme.
  Ciclo dei turnisti a scelta: P › M › N › S › R (quello di oggi), M › P › N › S › R
  (rotazione in avanti, la reperibilità va al turnista di mattina che il giorno dopo fa il
  pomeriggio) o 12 h G › N › S › R › R (giorno 08–20 = casella "G", notte 20–08; il ciclo
  dà 33 h 36 a settimana, quindi ogni 5 settimane in turno c'è un giorno da 12 h in più sul
  secondo riposo, dove mancano più diurnisti: si arriva a 36 h).
  Riposi dei diurnisti divisi anche sul venerdì. Dopo una notte sempre smonto e riposo,
  anche per il diurnista che la copre; mai 7 giorni di lavoro di fila.
  Reperibilità (regola fissa): arriva alle 13 del giorno dopo, quindi quel giorno il
  reperibile fa il pomeriggio (o la notte), mai la mattina. Se nessuno è già di pomeriggio
  il giorno dopo, scambia la mattina con un collega di pomeriggio (diurnista o turnista,
  ognuno col suo orario: la copertura resta uguale); nei giorni corti passa al pomeriggio
  se i buchi non aumentano. Con P›M›N e M›P›N non resta nessun caso; con i 12 h resta
  solo nei giorni in cui l'unico disponibile il giorno dopo fa il giorno da 12 h (circa
  una volta l'anno con le assenze), segnalato. Vale anche per le coperture automatiche
  e la ruota Auto; il controllo "!" del calendario segue la stessa regola. I piani hanno
  una versione del motore (`engine`): un anno generato con regole più vecchie si rifà da
  solo all'apertura dell'app, con le stesse scelte e assenze simulate.
- **Modifiche automatiche dalla ruota** (Modifica turni › barra sopra la ruota › "Auto"):
  con l'interruttore acceso, mettendo un'assenza su un turno il sostituto si trova da solo
  con le regole del generatore ("copertura turno di …", notte con smonto e riposo,
  reperibilità passata ad altri). Le modifiche restano in sospeso con l'assenza: Salva o
  Annulla le prende tutte insieme. Le etichette "copertura" stanno in
  `test_generatore/autocov_<anno>`; l'interruttore è per dispositivo (`gt_auto_edit`).
- **Menu rapido sotto la scritta AREA TEST** (freccia): rifà tutto l'anno con un altro
  modello diurnisti (6 h / 7 h 12), ciclo turnisti, 2ª notte, riposi del venerdì, oppure
  con **assenze simulate** come nel 2026 vero (C.O. ~28 giorni a testa in 4–5 periodi,
  ferie residue a inizio anno, 3–5 permessi, permessi notte sulle notti, malattie, recuperi,
  permessi legge), mai più di 2 assenti insieme; "con cambio ferie" aggiunge 2 giorni in cui
  due periodi di ferie finiscono e lo stesso giorno ne parte un terzo (3 assenti).
  Le assenze simulate stanno in `test_generatore/simassenze_<anno>` e si tolgono dal menu.
  "Aggiungi un operatore" mette NUOVO 1, NUOVO 2… in servizio da tutto l'anno, senza
  affiancamento né scadenza (subito turni e reperibilità); "Togli" leva l'ultimo aggiunto,
  "Togli tutti" li leva tutti. Stanno in `test_generatore/operatori` con `quick: true`.
  "Schema consigliato" = turnisti M › P › N › S › R, diurnisti 6 h, riposi anche il venerdì.

  Confronto (2027, assenze simulate come nel 2026, media di 8 anni casuali, 9 operatori):

  | Diurnisti / turnisti | Turni scoperti | Riposi < 11 h | Sab/dom liberi | Weekend interi | Giorni lavorati |
  |---|---|---|---|---|---|
  | 6 h · M › P › N › S › R | 30 | 0 | 17 | 0,3 | 200 |
  | 6 h · P › M › N › S › R | 30 | 31 | 17 | 0,3 | 200 |
  | 7 h 12 · M › P › N › S › R | 40 | 30 | 22 | 3 | 186 |
  | 7 h 12 · P › M › N › S › R | 40 | 60 | 22 | 3 | 186 |
  | 7 h 12 · turnisti 12 h | 34 | 29 | 30 | 8 | 158 |
  | 6 h · turnisti 12 h | 37 | 0 | 24 | 5 | 173 |

  I buchi che restano cadono quasi tutti nei giorni con 2 assenti (con 9 persone non c'è nessuno
  libero senza togliere un riposo). Il generatore sposta i riposi anche a coppie; la regola
  "Riposo spostato" (spenta di base) ne toglie altri ~5 l'anno col 7 h 12.
  Con un 10° operatore i turni scoperti scendono a 0,5–7 l'anno (7 h 12: 0,5, 6 h: 3, 12 h: 3–7).
- **Richieste dal portale**: il pannello che si apre con la freccia a destra dello schermo
  carica `richieste/` (copia del portale Richieste A.S. 118 collegata solo al Firebase
  finto tramite `firebase-modular-shim.js`, non a quello vero). Le richieste fatte lì
  arrivano qui. "In automatico" segna l'assenza
  e trova chi la copre; nel calendario generato compare "copertura turno di …".
  "Inserisci manualmente" segna solo l'assenza; i turni scoperti si sistemano toccando
  la casella.

## Segretario Marino (assistente Claude, solo area test)

Area coordinatore (password **118**) › Area test › **Segretario Marino** (`segretario.js`).
Si inserisce la propria chiave API di Claude: resta **solo nel browser** (localStorage, chiave
`seg_api_key`), non va su GitHub né nel database finto. Poi si chatta dalla faccia di Marino in basso
a destra (visibile solo da coordinatore). Marino legge il calendario, conta le ore,
cambia caselle e reperibilità con gli stessi strumenti di Modifica turni (modifiche in sospeso,
annullabili, salvate solo quando glielo si chiede), porta il calendario su un giorno e può
lanciare il generatore annuale. Modello a scelta nella sezione: `claude-sonnet-5-5` (predefinito, costa la metà) o `claude-opus-5-5`. SDK ufficiale caricato da jsDelivr.
Ha un carattere scherzoso e ogni tanto prende in giro il coordinatore.

Attenzione: le chiamate a Claude partono dal browser, quindi la chiave è leggibile da chi usa
il dispositivo o da un'estensione del browser. Usare una chiave dedicata con limite di spesa
e cancellarla dalla sezione quando non serve.
