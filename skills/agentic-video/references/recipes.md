# Recipes

Copy-paste starting points. Each is a real chain that has been run. Adjust, don't improvise from
scratch — and always pass the **printed** output path from one step into the next.

Remember: markup, arrays and objects go through `--json file.json`, never `--input k=v`.

---

## 1. HTML → image → video

Author a graphic in HTML/CSS, rasterise it, then give it motion. No stock, no keys, no AI.

```bash
# 1. write the input file (node keeps the quoting sane)
node -e "const fs=require('fs');fs.writeFileSync('card.json',JSON.stringify({
  html:'<div class=\"c\"><h1>Ocean Plastic</h1><p>12 million tonnes every year</p></div>',
  css:'.c{width:1080px;height:1920px;background:#06121f;color:#fff;display:flex;flex-direction:column;justify-content:center;padding:120px;font-family:system-ui}h1{font-size:110px;margin:0}p{font-size:44px;color:#38bdf8;margin-top:20px}',
  width:1080,height:1920,out:'card.png'
}))"

# 2. rasterise in a real browser
npm run forge -- run image.create --json card.json

# 3. give it a Ken Burns move
npm run forge -- run motion.effect --input file=card.png --input effect=kenBurns \
  --input duration=5 --input zoomTo=1.15 --input width=1080 --input height=1920
```

Variants: `effect=punchIn|punchOut|shake|parallax`. For several stills use
`video.from_images` with `{files:[...]}`.

---

## 2. Pexels documentary short

Stock imagery, narration, music, captions, assembly.

```bash
npm run forge -- run image.download --input provider=pexels --input query="ocean waves" \
  --input count=6 --input orientation=landscape
npm run forge -- run voice.tts   --input text="Every year, twelve million tonnes..." \
  --input voice=en-US-AriaNeural
npm run forge -- run music.generate --input key=A --input bpm=84 --input bars=16
npm run forge -- run audio.merge --json mix.json          # {voice, music, duck:true}
npm run forge -- run video.from_images --json from-images.json
npm run forge -- run subtitle.create --json subs.json     # cues is an ARRAY
npm run forge -- run subtitle.burn --input video=reel.mp4 --input subtitles=subs.srt
npm run forge -- run export.probe --input file=final.mp4
```

`music.generate` wants `key: "A"`, **not** `"Am"`.

---

## 3. Website tour

Capture a live page, then turn the stills into a video.

```bash
npm run forge -- run browser.screenshot --input url=https://example.com --input fullPage=true
npm run forge -- run browser.scroll_capture --input url=https://example.com --input steps=6
npm run forge -- run video.from_images --json scroll.json   # the 6 stills
npm run forge -- run motion.effect --input file=shot.png --input effect=parallax --input duration=4
```

For an actual recording of the interaction, use `browser.record_flow` with an actions array. It
launches headed on purpose (Headless Shell cannot record) — under `xvfb-run` on a server.

---

## 4. Remotion motion-graphics sting

```bash
npm run forge -- run motion.remotion_template --input template=glitch-title \
  --input text="AGENTIC" --input durationInFrames=60
npm run forge -- run motion.remotion_template --input template=stat-counter \
  --input label="Videos rendered" --input value=128 --input suffix=k --input durationInFrames=75
npm run forge -- run video.merge --json merge.json
```

20 templates available — see [remotion-templates.md](remotion-templates.md). First render is slow
(~25 s bundling); that is normal.

---

## 5. The kitchen sink

Everything at once: stock stills + stock footage + an authored HTML card + a website capture +
Remotion graphics + voice + music + captions, assembled with transitions and verified.

Runnable version: [../workflows/kitchen-sink.json](../workflows/kitchen-sink.json)

```
image.download → video.download → image.create → browser.screenshot
→ motion.remotion_template (×2) → motion.effect (stills)
→ voice.tts → music.generate → audio.merge
→ subtitle.create → subtitle.burn
→ render.timeline → export.probe → qc.gate
```

---

## 6. Verify anything

```bash
npm run forge -- run export.probe --input file=final.mp4
npm run forge -- run qc.gate --input file=final.mp4
npm run forge -- run export.contact_sheet --input file=final.mp4 --input cols=4 --input rows=4
```

`export.probe` returns `{video:{codec,width,height,fps}, audio:{codec}}` — nested, not a
`streams` array.

---

## 7. Batch replay

Any of the above can be written as a step file and replayed:

```json
{
  "steps": [
    { "plugin": "image.download", "input": { "provider": "pexels", "query": "ocean", "count": 4 } },
    { "plugin": "video.from_images", "input": { "dir": "workspace/artifacts/image.download", "durationPerImage": 3 } }
  ]
}
```

```bash
npm run forge steps steps.json
```

The runner **stops at the first failure** and reports which steps were not executed. It never
substitutes or retries.
