# Inferenz-Servicepaket

Erstellt mit Wulabel. Es liest die Videostreams der Kameras, wertet sie mit dem trainierten Modell aus und sendet einen Alarm, sobald ein Ziel erkannt wird. Außerdem stellt es eine HTTP-API zur Erkennung bereit.

## Ausführen

Benötigt Python 3.9 oder neuer (kein PyTorch und keine Grafikkarte nötig).

- Windows: Doppelklick auf `run.bat`
- Linux: `sh run.sh`

Beim ersten Start wird automatisch eine Python-Umgebung angelegt, und onnxruntime, opencv und numpy werden installiert (ca. 100 MB). Danach startet der Dienst sofort.

Inferenz auf einer NVIDIA-GPU: Ersetzen Sie in `requirements.txt` `onnxruntime` durch `onnxruntime-gpu`, löschen Sie den Ordner `venv` und starten Sie erneut.

## Konfiguration: config.json

```jsonc
{
  "model": "model.onnx",
  "gpu": true,                 // GPU verwenden, wenn onnxruntime-gpu installiert ist
  "max_side": 1280,            // lange Bildseite vor der Erkennung auf diese Größe verkleinern; kleiner ist schneller
  "port": 8090,                // Port der HTTP-API
  "interval": 1.0,             // alle N Sekunden ein Bild pro Stream auswerten
  "streams": [
    {
      "name": "Nordtor",
      "url": "rtsp://admin:passwort@192.168.1.64:554/Streaming/Channels/101",
      "region": [[0.1, 0.4], [0.9, 0.4], [0.9, 1.0], [0.1, 1.0]]  // optional: Erkennungsbereich, Koordinaten als Anteil 0–1
    }
  ],
  "alert": {
    "labels": ["ohne_helm"],   // nur bei diesen Klassen alarmieren; leer = alle Klassen
    "min_score": 0.5,          // Konfidenzschwelle
    "cooldown": 60,            // höchstens ein Alarm pro N Sekunden für denselben Stream und dieselbe Klasse
    "hours": "07:00-19:00",    // aktive Zeit; leer = ganztägig; über Mitternacht "22:00-06:00" schreiben
    "save_image": true         // Alarm-Schnappschüsse in alerts/ speichern
  },
  "webhook": { "url": "http://ihre-plattform/api/alarm", "with_image": false, "headers": {} },
  "mqtt": { "host": "", "port": 1883, "topic": "xlabel/alarm", "username": "", "password": "" },
  "reflux": { "enabled": true, "low": 0.3, "high": 0.5, "interval": 60 }
}
```

- Als Quelle kann auch der Pfad zu einer lokalen Videodatei angegeben werden, zum Testen (wird standardmäßig in Schleife abgespielt).
- Der Erkennungsbereich wird anhand des **Mittelpunkts der Unterkante** jeder Box geprüft (dort, wo Person oder Fahrzeug steht).

## Alarmnachricht

Nachricht, die an den Webhook (POST JSON) und per MQTT gesendet wird:

```json
{
  "stream": "Nordtor",
  "time": "2026-11-01T08:30:15",
  "labels": ["ohne_helm"],
  "detections": [{ "label": "ohne_helm", "score": 0.91, "box": [x, y, w, h] }],
  "width": 1920,
  "height": 1080,
  "image": "alerts/20261101/Nordtor_083015.jpg"
}
```

Ist `with_image` beim Webhook aktiviert, kommt ein zusätzliches Feld `image_base64` hinzu (JPEG mit eingezeichneten Boxen).

## HTTP-API

| Endpunkt | Beschreibung |
|---|---|
| `GET /health` | Dienststatus und ob jeder Stream online ist |
| `GET /alerts?limit=50` | Letzte Alarme |
| `GET /alerts/20261101/xxx.jpg` | Alarm-Schnappschuss |
| `POST /predict?conf=0.4` | Ein Bild hochladen (Bilddatei direkt als Request-Body oder JSON `{"image": "base64"}`) und die Erkennungen zurückerhalten |

```bash
curl -X POST --data-binary @test.jpg "http://127.0.0.1:8090/predict?conf=0.4"
```

## Rückfluss aus dem Feld

Bilder, bei denen sich das Modell unsicher ist (Konfidenz zwischen `low` und `high`), werden in `reflux/` gespeichert (höchstens eines pro Stream alle `interval` Sekunden).
Kopieren Sie den Ordner `reflux` regelmäßig zurück, klicken Sie in Wulabel auf der Seite „Bereitstellen“ auf „Bilder aus dem Feldeinsatz importieren“, annotieren Sie die Bilder und trainieren Sie neu – so wird das Modell mit der Zeit immer genauer.

## Dateien

```
model.onnx / model.json   Modell und Klassen
service.py                Dienstprogramm
config.json               Konfiguration
alerts/                   Alarm-Schnappschüsse
reflux/                   Bilder aus dem Feld
logs/service.log          Log
```
