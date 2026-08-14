# -*- coding: utf-8 -*-
"""
tts-superloja.py — a voz do bot, com rede por baixo.

Uso:  python tts-superloja.py --file texto.txt --out saida.mp3 [--motor auto|edge|kokoro]

PORQUÊ DOIS MOTORES: o Edge TTS (voz Raquel, pt-PT) é o mais natural mas é um
serviço cloud NÃO-OFICIAL da Microsoft — pode morrer sem aviso, e a 13-Ago o
bot ficou dependente dele. O Kokoro-82M corre 100% LOCAL (CPU, sem rede,
Apache 2.0) com voz pt-BR — menos ajustada a Luanda mas sempre disponível.

Ordem em `auto`: Edge primeiro (melhor voz), Kokoro se o Edge falhar.
Quando o Kokoro assume, escreve "motor=kokoro" no stdout — o bot regista no log
e o dono fica a saber que o Edge caiu sem que nenhum cliente fique sem voz.

O texto entra por FICHEIRO UTF-8, nunca por argumento: na linha de comandos do
Windows os acentos corrompem-se (cp1252) e há o tecto dos ~32k caracteres.
"""
import argparse
import os
import sys

# stdout UTF-8 — sem isto qualquer print com acentos rebenta em cp1252
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

TTS_DIR = os.environ.get("TTS_DIR", "C:/superloja/data/tts")
VOZ_EDGE = os.environ.get("TTS_VOZ", "pt-PT-RaquelNeural")
VOZ_KOKORO = os.environ.get("TTS_VOZ_KOKORO", "pf_dora")   # pt-BR feminina


def sintetizar_edge(texto: str, destino: str) -> bool:
    try:
        import asyncio
        import edge_tts

        async def _run():
            com = edge_tts.Communicate(texto, VOZ_EDGE)
            await com.save(destino)

        asyncio.get_event_loop().run_until_complete(_run())
        return os.path.exists(destino) and os.path.getsize(destino) > 1000
    except Exception as e:
        print("edge falhou: " + str(e)[:120], file=sys.stderr)
        return False


def sintetizar_kokoro(texto: str, destino: str) -> bool:
    try:
        import soundfile as sf
        from kokoro_onnx import Kokoro

        modelo = os.path.join(TTS_DIR, "kokoro-v1.0.onnx")
        vozes = os.path.join(TTS_DIR, "voices-v1.0.bin")
        if not (os.path.exists(modelo) and os.path.exists(vozes)):
            print("kokoro: faltam os ficheiros do modelo em " + TTS_DIR, file=sys.stderr)
            return False
        kk = Kokoro(modelo, vozes)
        samples, sample_rate = kk.create(texto, voice=VOZ_KOKORO, speed=1.0, lang="pt-br")
        # o bridge converte qualquer formato para ogg/opus (ptt) via ffmpeg —
        # wav é o caminho sem perdas e sem dependências extra
        wav = destino if destino.endswith(".wav") else destino + ".wav"
        sf.write(wav, samples, sample_rate)
        if wav != destino:
            os.replace(wav, destino)
        return os.path.exists(destino) and os.path.getsize(destino) > 1000
    except Exception as e:
        print("kokoro falhou: " + str(e)[:120], file=sys.stderr)
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True, help="ficheiro UTF-8 com o texto")
    ap.add_argument("--out", required=True, help="ficheiro de saída (mp3/wav)")
    ap.add_argument("--motor", default=os.environ.get("TTS_MOTOR", "auto"),
                    choices=["auto", "edge", "kokoro"])
    args = ap.parse_args()

    with open(args.file, "r", encoding="utf-8") as f:
        texto = f.read().strip()
    if not texto:
        print("texto vazio", file=sys.stderr)
        sys.exit(2)

    if args.motor in ("auto", "edge") and sintetizar_edge(texto, args.out):
        print("motor=edge")
        sys.exit(0)
    if args.motor in ("auto", "kokoro") and sintetizar_kokoro(texto, args.out):
        print("motor=kokoro")
        sys.exit(0)
    print("nenhum motor conseguiu sintetizar", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
