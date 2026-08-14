"""Transcreve uma nota de voz de cliente (WhatsApp/Messenger) para texto.

Corre com o Python do venv do Hermes (que tem o faster-whisper instalado):
    <venv>/Scripts/python.exe transcrever-audio.py <ficheiro> [modelo]

Escreve APENAS a transcricao no stdout (ou nada, se falhar) — quem chama trata
o vazio como "nao consegui ouvir" e pede texto ao cliente, em vez de adivinhar.

Local e gratuito: sem chave de API, sem enviar a voz do cliente para fora.
O modelo (~150 MB no 'base') e descarregado na primeira utilizacao e fica em
cache; a partir dai a transcricao e offline.
"""
import sys
import os

def main():
    # UTF-8 a forca: a consola do Windows e cp1252 e "preco dos" saia como
    # "pr?-cudus" — acentos corrompidos chegariam assim ao prompt da IA
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass
    if len(sys.argv) < 2:
        return 1
    caminho = sys.argv[1]
    modelo = sys.argv[2] if len(sys.argv) > 2 else os.getenv("STT_MODELO", "base")
    if not os.path.exists(caminho):
        print("ficheiro nao existe: " + caminho, file=sys.stderr)
        return 1
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("faster_whisper nao instalado", file=sys.stderr)
        return 2

    try:
        # int8 no CPU: e o que torna isto viavel numa maquina sem GPU
        m = WhisperModel(modelo, device="cpu", compute_type="int8")
        # language='pt' explicito: sem isto o whisper as vezes deteta espanhol
        # em audio curto com ruido e devolve disparate
        segmentos, _info = m.transcribe(
            caminho,
            language="pt",
            beam_size=1,              # rapidez > perfeicao: o cliente espera
            vad_filter=True,          # corta silencios (notas de voz tem muitos)
            condition_on_previous_text=False,
        )
        texto = " ".join(s.text.strip() for s in segmentos).strip()
        if texto:
            sys.stdout.write(texto)
        return 0
    except Exception as e:  # noqa: BLE001 — qualquer falha = "nao consegui ouvir"
        print("falha a transcrever: " + str(e)[:200], file=sys.stderr)
        return 3

if __name__ == "__main__":
    sys.exit(main())
