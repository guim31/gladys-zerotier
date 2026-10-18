# ZeroTier

Verfolge die Mitglieder deiner [ZeroTier](https://www.zerotier.com)-Netzwerke
in Gladys: ein Gerät pro Mitglied (online oder nicht, autorisiert oder nicht,
zuletzt gesehen, verwaltete IP-Adresse, ZeroTier-Version), ein Gerät pro
Netzwerk, ein Dashboard-Widget und Szenen-Auslöser, wenn ein Mitglied online
oder offline geht oder beitreten möchte — zum Beispiel, um zu wissen, dass ein
Handy wieder im Familiennetz ist oder dass ein unbekanntes Gerät an die Tür
eines privaten Netzwerks klopft.

Die Integration funktioniert mit **ZeroTier Central** (my.zerotier.com, die Cloud) oder
mit einem **selbst gehosteten Controller** (deinem eigenen ZeroTier-Knoten,
der seine Netzwerke verwaltet). Der selbst gehostete Modus wurde mit einem
echten ZeroTier-1.14.2-Controller und einem echten Mitglied in Docker getestet.
Der Central-Modus wurde nach der offiziellen API-Dokumentation entwickelt,
**ohne echtes Central-Konto: Rückmeldungen sind willkommen** im
[Gladys-Forum](https://community.gladysassistant.com) oder in den
[Issues](https://github.com/guim31/gladys-zerotier/issues).

## Was du brauchst

- Gladys Assistant 5.1.0 oder neuer.
- **ZeroTier Central**: ein API-Token des Kontos, dem die Netzwerke gehören
  (my.zerotier.com → Account → API Access Tokens), und Internetzugang für
  Gladys.
- **Selbst gehosteter Controller**: der ZeroTier-Knoten, auf dem der
  Controller läuft, von Gladys aus über seinen Port 9993 erreichbar, der Inhalt
  seiner Datei `authtoken.secret` und die Adresse von Gladys in seiner
  `local.conf` erlaubt (siehe unten).

## Einrichtung

1. Installiere die Integration in Gladys und öffne dann ihre
   **Konfiguration**.
2. **Controller**: _ZeroTier Central (Cloud)_ oder _Selbst gehosteter
   Controller (lokal)_.
3. **API-Token**: das Token von Central oder der Inhalt von
   `authtoken.secret`.
4. **Zu verfolgende Netzwerke**: die Netzwerk-IDs (16 Zeichen, wie Central oder
   `zerotier-cli listnetworks` sie anzeigt), durch Kommas getrennt. Leer: alle
   Netzwerke, die das Token sieht.
5. **Aktualisierungsintervall**: standardmäßig 1 Minute. Jede Abfrage kostet
   eine Anfrage, plus eine pro Netzwerk.
6. **Autorisieren von Mitgliedern erlauben**: standardmäßig aus (siehe die
   Geräte unten).
7. **Sprache der Namen**: die Sprache der Funktionsnamen und der Daten,
   standardmäßig Französisch.
8. Speichere und drücke dann **Verbindung testen**: Jedes Netzwerk wird mit
   seinen Mitgliedern angezeigt. Die Geräte erscheinen danach im Tab
   **Erkennung** der Integration: Füge die hinzu, die du möchtest.

### ZeroTier Central

Erstelle ein Token unter my.zerotier.com → **Account** → **API Access
Tokens**. Es gibt Zugriff auf alle Netzwerke des Kontos: Behalte es für dich.
Central begrenzt die Zahl der API-Anfragen pro Konto: Behalte das
Standardintervall, wenn andere Werkzeuge dasselbe Token nutzen.

### Selbst gehosteter Controller

Standardmäßig antwortet die lokale API von ZeroTier nur dem Knoten selbst.
Erlaube die Adresse, von der Gladys aus aufruft, in der Datei `local.conf` des
ZeroTier-Ordners des Controllers (`/var/lib/zerotier-one` unter Linux) und
starte ZeroTier dann neu:

```json
{ "settings": { "allowManagementFrom": ["192.168.1.0/24"] } }
```

Gladys ruft von ihrem Rechner aus auf (die Integration läuft in einem
Docker-Container an der Standard-Bridge): Erlaube die Adresse des
Gladys-Rechners oder, wenn der Controller auf demselben Rechner läuft, den
Docker-Bereich (`172.16.0.0/12`). Als **Adresse des Controllers (selbst
gehostet)** gibst du die Adresse des Controller-Rechners in deinem lokalen
Netzwerk an, nie `127.0.0.1`.

## Die Geräte

**Jedes Netzwerk** (`ZeroTier` gefolgt von seinem Namen):

| Funktion                 | Was sie zeigt                                     |
| ------------------------ | ------------------------------------------------- |
| Mitglieder online        | Die Mitglieder, die gerade online sind            |
| Mitglieder               | Die Mitglieder des Netzwerks                      |
| Warten auf Autorisierung | Mitglieder, die beitreten möchten und noch warten |

**Jedes Mitglied** (sein Name oder, wenn es keinen hat, seine Knoten-ID,
gefolgt von `(ZeroTier)`):

| Funktion              | Was sie zeigt                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------ |
| Online                | Ja, wenn das Mitglied höchstens vor ein paar Minuten gesehen wurde                         |
| Autorisiert           | Ob das Mitglied im Netzwerk autorisiert ist (ein Schalter, standardmäßig schreibgeschützt) |
| Zuletzt gesehen       | Datum und Uhrzeit, zu der das Mitglied zuletzt gesehen wurde                               |
| Verwaltete IP-Adresse | Die Adressen, die das Netzwerk ihm gibt (`Keine`, wenn es keine hat)                       |
| ZeroTier-Version      | Die ZeroTier-Version des Mitglieds                                                         |

Derselbe Rechner in zwei Netzwerken ergibt zwei Geräte: Seine Autorisierung
gilt pro Netzwerk.

**Online** wird je nach Modus anders gelesen. Mit Central ist ein Mitglied
online, wenn es sich vor weniger als 5 Minuten bei Central gemeldet hat
(Mitglieder melden sich etwa jede Minute). Mit einem selbst gehosteten
Controller speichert der Controller dieses Datum nicht: Die Integration liest
die Peers des Knotens, und ein Mitglied ist online, wenn der Controller es vor
weniger als 3 Minuten gehört hat. Ein Mitglied, das über ein Relay erreicht
wird (ohne direkten Pfad), gilt als online, solange der Knoten es auflistet.

**Autorisiert** wird nur zu einem Befehl, wenn **Autorisieren von Mitgliedern
erlauben** aktiviert ist: Dann können Gladys, ihre Szenen und Sprachassistenten
ein Mitglied zulassen oder aussperren. Das Ein- oder Ausschalten der Option
ändert das Gerät: Drücke **Aktualisieren** im Tab Erkennung.

## Dashboard

Das Widget **ZeroTier-Mitglieder** zeigt die Mitglieder online und die
Mitglieder der Netzwerke, dann eine Zeile pro Mitglied: zuerst die, die auf
Autorisierung warten, dann die, die online sind, dann die anderen mit dem
Zeitpunkt, zu dem sie zuletzt gesehen wurden. Seine Einstellung **Netzwerk
(leer: alle)** zeigt nur ein Netzwerk.

## Szenen

### Auslöser

- **ZeroTier-Mitglied online**: Ein Mitglied ist online gegangen.
- **ZeroTier-Mitglied offline**: Ein Mitglied wurde seit einigen Minuten nicht
  mehr gesehen.
- **Neues Mitglied wartet auf Autorisierung**: Ein neues Gerät möchte einem
  privaten Netzwerk beitreten.

Jeder Auslöser lässt sich auf ein Mitglied (**Mitglied (leer: beliebig)**)
oder ein Netzwerk (**Netzwerk (leer: beliebig)**) beschränken und gibt die
Variablen **Name des Mitglieds**, **Knoten-ID** und **Name des Netzwerks** an
die Nachrichten der Szene weiter. Bei der ersten Abfrage nach einem Start oder
einer Änderung der Konfiguration wird kein Ereignis gesendet: Der vorherige
Zustand ist unbekannt.

### Szenen-Ideen

- Wenn ein neues Mitglied auf Autorisierung wartet, schick dir eine Nachricht
  mit seiner **Knoten-ID** und dem **Name des Netzwerks** und autorisiere es
  dann in Central oder über sein Gerät in Gladys.
- Wenn der Laptop eines Teenagers nach 23 Uhr online geht, schick eine
  Benachrichtigung.
- Wenn das entfernte NAS mit deinen Backups offline geht, schick eine
  Nachricht.

## Fehlerbehebung

- **„API-Token abgelehnt“**: Prüfe das Token. Bei einem selbst gehosteten
  Controller ist es der ganze Inhalt von `authtoken.secret`, ohne
  Zeilenumbruch.
- **„ZeroTier antwortet nicht“**: Prüfe bei Central den Internetzugang von
  Gladys. Prüfe bei einem selbst gehosteten Controller die Adresse und den Port
  (9993) und ob `allowManagementFrom` Gladys erlaubt (siehe oben).
- **„Netzwerk nicht gefunden“**: Die Netzwerk-ID ist falsch oder das Token
  sieht dieses Netzwerk nicht.
- **„dieser ZeroTier-Knoten ist kein Netzwerk-Controller“**: Die Adresse ist
  die eines gewöhnlichen ZeroTier-Knotens, nicht die des Controllers deiner
  Netzwerke.
- **„zu viele Anfragen an ZeroTier Central“**: Die Integration wartet bereits
  länger zwischen zwei Abfragen; wähle ein längeres Intervall.
- **Ein Mitglied bleibt nach dem Ausschalten online**: Das dauert bis zu 5
  Minuten plus eine Abfrage, bei einem über ein Relay erreichten Mitglied eines
  selbst gehosteten Controllers bis zu etwa 9 Minuten.

## Grenzen

- Ein Controller (oder ein Central-Konto) pro Installation der Integration.
- Die Integration erstellt keine Netzwerke und benennt keine Mitglieder um oder
  löscht sie: Das bleibt in Central oder auf deinem Controller.
- Das Datum „zuletzt gesehen“ eines selbst gehosteten Controllers wird im
  Speicher gehalten: Nach einem Neustart der Integration ist es wieder
  unbekannt, bis das Mitglied erneut gesehen wird.
- In Central gelöschte Mitglieder (von Central ausgeblendet) werden nicht
  angezeigt.
- Nicht mit ZeroTier, Inc. verbunden. ZeroTier ist eine Marke von ZeroTier,
  Inc.
