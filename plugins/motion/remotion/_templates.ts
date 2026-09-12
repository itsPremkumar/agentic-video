/**
 * Reusable Remotion composition templates.
 *
 * Each builder returns a complete TSX file (a default-exported React component)
 * that the motion.remotion_template plugin passes to motion.remotion to bundle
 * and render. Templates are deliberately small but expressive: they cover
 * the elements that show up in almost every video (lower thirds, titles,
 * end-cards, countdowns, progress bars, kinetic text).
 */

function header() {
    return "import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate, Easing } from 'remotion';\n\n";
}

function lowerThird(): string {
    return header() +
        "type P = { name: string; title: string; accent: string; bg: string };\n" +
        "export default function LowerThird({ name, title, accent, bg }: P) {\n" +
        "  const frame = useCurrentFrame();\n" +
        "  const inAnim = interpolate(frame, [0, 18], [-220, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });\n" +
        "  const outAnim = interpolate(frame, [150, 180], [0, -220], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic) });\n" +
        "  const opacity = interpolate(frame, [0, 12, 150, 180], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });\n" +
        "  return (\n" +
        "    <AbsoluteFill style={{ backgroundColor: bg }}>\n" +
        "      <div style={{ position: 'absolute', bottom: 80, left: 80, transform: `translateX(${inAnim + (frame > 150 ? outAnim : 0)}px)`, opacity, display: 'flex' }}>\n" +
        "        <div style={{ width: 8, backgroundColor: accent, borderRadius: 4 }} />\n" +
        "        <div style={{ marginLeft: 20, color: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif' }}>\n" +
        "          <div style={{ fontSize: 56, fontWeight: 700 }}>{name}</div>\n" +
        "          <div style={{ fontSize: 28, color: '#94a3b8', marginTop: 8 }}>{title}</div>\n" +
        "        </div>\n" +
        "      </div>\n" +
        "    </AbsoluteFill>\n" +
        "  );\n" +
        "}\n";
}

function titleCard(): string {
    return header() +
        "type P = { line1: string; line2: string; accent: string; bg: string };\n" +
        "export default function TitleCard({ line1, line2, accent, bg }: P) {\n" +
        "  const frame = useCurrentFrame();\n" +
        "  const { fps } = useVideoConfig();\n" +
        "  const enter = spring({ frame, fps, config: { damping: 14, mass: 0.6, stiffness: 110 } });\n" +
        "  const y = interpolate(enter, [0, 1], [60, 0]);\n" +
        "  const subOp = interpolate(frame, [40, 70], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });\n" +
        "  return (\n" +
        "    <AbsoluteFill style={{ backgroundColor: bg }}>\n" +
        "      <svg width={1080} height={1080} viewBox=\"0 0 1080 1080\" style={{ position: 'absolute', inset: 0 }}>\n" +
        "        <radialGradient id=\"g\" cx=\"0.5\" cy=\"0.45\" r=\"0.6\"><stop offset=\"0\" stopColor={accent} stopOpacity=\"0.45\"/><stop offset=\"1\" stopColor={accent} stopOpacity=\"0\"/></radialGradient>\n" +
        "        <rect width=\"1080\" height=\"1080\" fill=\"url(#g)\"/>\n" +
        "      </svg>\n" +
        "      <div style={{ position: 'absolute', top: 440, left: 0, width: 1080, textAlign: 'center', color: '#f8fafc', fontFamily: 'Georgia, serif', fontWeight: 700, transform: `translateY(${y}px)`, opacity: enter }}>\n" +
        "        <div style={{ fontSize: 100 }}>{line1}</div>\n" +
        "        <div style={{ fontSize: 100, color: accent, marginTop: 16 }}>{line2}</div>\n" +
        "        <div style={{ width: 160, height: 6, background: accent, margin: '40px auto 0', borderRadius: 3, opacity: subOp }} />\n" +
        "        <div style={{ marginTop: 28, color: '#94a3b8', fontSize: 28, letterSpacing: 8, opacity: subOp }}>PRESENTED</div>\n" +
        "      </div>\n" +
        "    </AbsoluteFill>\n" +
        "  );\n" +
        "}\n";
}

function endCta(): string {
    return header() +
        "type P = { headline: string; subline: string; cta: string; accent: string; bg: string };\n" +
        "export default function EndCta({ headline, subline, cta, accent, bg }: P) {\n" +
        "  const frame = useCurrentFrame();\n" +
        "  const { fps } = useVideoConfig();\n" +
        "  const enter = spring({ frame, fps, config: { damping: 12, mass: 0.5, stiffness: 90 } });\n" +
        "  const btnScale = interpolate(enter, [0, 1], [0.85, 1]);\n" +
        "  const btnOp = interpolate(frame, [25, 55], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });\n" +
        "  return (\n" +
        "    <AbsoluteFill style={{ backgroundColor: bg }}>\n" +
        "      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#f8fafc', fontFamily: 'system-ui, sans-serif', opacity: enter }}>\n" +
        "        <div style={{ fontSize: 86, fontWeight: 700, transform: `translateY(${interpolate(enter,[0,1],[40,0])}px)` }}>{headline}</div>\n" +
        "        <div style={{ marginTop: 12, fontSize: 36, color: '#94a3b8' }}>{subline}</div>\n" +
        "        <div style={{ marginTop: 60, padding: '24px 56px', background: accent, borderRadius: 999, fontSize: 40, fontWeight: 600, transform: `scale(${btnScale})`, opacity: btnOp }}>{cta}</div>\n" +
        "      </div>\n" +
        "    </AbsoluteFill>\n" +
        "  );\n" +
        "}\n";
}

function countdown(): string {
    return header() +
        "type P = { from: number; accent: string; bg: string };\n" +
        "export default function Countdown({ from, accent, bg }: P) {\n" +
        "  const frame = useCurrentFrame();\n" +
        "  const { fps } = useVideoConfig();\n" +
        "  const remaining = Math.max(0, from - Math.floor(frame / fps));\n" +
        "  const isGo = remaining === 0;\n" +
        "  const t = frame % fps;\n" +
        "  const scale = interpolate(t, [0, fps * 0.4, fps * 0.8, fps], [1.2, 1, 1.2, 2.4], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });\n" +
        "  const op = interpolate(t, [0, fps * 0.1, fps * 0.9, fps], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });\n" +
        "  return (\n" +
        "    <AbsoluteFill style={{ backgroundColor: bg }}>\n" +
        "      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: isGo ? accent : '#f8fafc', fontFamily: 'system-ui, sans-serif', fontSize: 420, fontWeight: 800, transform: `scale(${scale})`, opacity: op }}>\n" +
        "        {isGo ? 'GO!' : String(remaining)}\n" +
        "      </div>\n" +
        "      <div style={{ position: 'absolute', bottom: 60, left: 0, width: '100%', textAlign: 'center', color: '#94a3b8', fontSize: 28, letterSpacing: 6 }}>{isGo ? '' : 'GET READY'}</div>\n" +
        "    </AbsoluteFill>\n" +
        "  );\n" +
        "}\n";
}

function progressBar(): string {
    return header() +
        "type P = { label: string; percent: number; accent: string; bg: string };\n" +
        "export default function ProgressBar({ label, percent, accent, bg }: P) {\n" +
        "  const frame = useCurrentFrame();\n" +
        "  const { fps, width, height, durationInFrames } = useVideoConfig();\n" +
        "  const filled = Math.min(1, frame / durationInFrames);\n" +
        "  const target = Math.max(0, Math.min(1, percent / 100));\n" +
        "  const value = interpolate(filled, [0, 1], [0, target], { extrapolateRight: 'clamp' });\n" +
        "  return (\n" +
        "    <AbsoluteFill style={{ backgroundColor: bg }}>\n" +
        "      <div style={{ position: 'absolute', top: height / 2 - 80, left: 0, width, color: '#f8fafc', fontFamily: 'system-ui, sans-serif', textAlign: 'center' }}>\n" +
        "        <div style={{ fontSize: 40, fontWeight: 600 }}>{label}</div>\n" +
        "        <div style={{ marginTop: 16, fontSize: 88, fontWeight: 800, color: accent }}>{Math.round(value * 100)}%</div>\n" +
        "        <div style={{ marginTop: 24, width: width - 200, height: 14, background: 'rgba(255,255,255,0.15)', borderRadius: 7, margin: '24px auto 0' }}>\n" +
        "          <div style={{ width: `${value * 100}%`, height: 14, background: accent, borderRadius: 7 }} />\n" +
        "        </div>\n" +
        "      </div>\n" +
        "    </AbsoluteFill>\n" +
        "  );\n" +
        "}\n";
}

function kineticText(): string {
    return header() +
        "type P = { words: string[]; accent: string; bg: string };\n" +
        "export default function KineticText({ words, accent, bg }: P) {\n" +
        "  const frame = useCurrentFrame();\n" +
        "  const { fps } = useVideoConfig();\n" +
        "  const perWord = 8;\n" +
        "  return (\n" +
        "    <AbsoluteFill style={{ backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>\n" +
        "      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 28, padding: 80, color: '#f8fafc', fontFamily: 'Georgia, serif', fontSize: 92, fontWeight: 700, textAlign: 'center' }}>\n" +
        "        {words.map((w, i) => {\n" +
        "          const local = frame - i * perWord;\n" +
        "          const op = interpolate(local, [0, 6, 22, 30], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });\n" +
        "          const y = interpolate(local, [0, 6], [40, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });\n" +
        "          return <span key={i} style={{ color: i === words.length - 1 ? accent : '#f8fafc', opacity: op, transform: `translateY(${y}px)`, display: 'inline-block' }}>{w}</span>;\n" +
        "        })}\n" +
        "      </div>\n" +
        "    </AbsoluteFill>\n" +
        "  );\n" +
        "}\n";
}

function barChartInfographic(): string {
    return header() +
        "type P = { title: string; bars: { label: string; value: number }[]; accent: string; bg: string };\n" +
        "export default function BarChartInfographic({ title, bars, accent, bg }: P) {\n" +
        "  const frame = useCurrentFrame();\n" +
        "  const { fps } = useVideoConfig();\n" +
        "  const max = Math.max(1, ...bars.map((b) => b.value));\n" +
        "  const totalW = 1080 - 160;\n" +
        "  const perW = totalW / Math.max(1, bars.length);\n" +
        "  return (\n" +
        "    <AbsoluteFill style={{ backgroundColor: bg, padding: 80, color: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif' }}>\n" +
        "      <div style={{ fontSize: 56, fontWeight: 700, marginBottom: 24 }}>{title}</div>\n" +
        "      <div style={{ position: 'relative', height: 760, width: totalW, display: 'flex', alignItems: 'flex-end', gap: 16 }}>\n" +
        "        {bars.map((b, i) => {\n" +
        "          const delay = i * 6;\n" +
        "          const h = interpolate(frame, [delay, delay + 28], [0, (b.value / max) * 700], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });\n" +
        "          return (\n" +
        "            <div key={i} style={{ position: 'relative', width: perW - 24, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center' }}>\n" +
        "              <div style={{ position: 'absolute', bottom: 0, width: '100%', height: h, background: 'linear-gradient(180deg, ' + accent + ' 0%, rgba(0,0,0,0) 100%)', borderRadius: 12 }} />\n" +
        "              <div style={{ position: 'absolute', bottom: -36, fontSize: 22, color: '#94a3b8' }}>{b.label}</div>\n" +
        "              <div style={{ position: 'absolute', top: -36, fontSize: 26, fontWeight: 600 }}>{b.value}</div>\n" +
        "            </div>\n" +
        "          );\n" +
        "        })}\n" +
        "      </div>\n" +
        "    </AbsoluteFill>\n" +
        "  );\n" +
        "}\n";
}

function logoReveal(): string {
    return header() +
        "type P = { brand: string; accent: string; bg: string };\n" +
        "export default function LogoReveal({ brand, accent, bg }: P) {\n" +
        "  const frame = useCurrentFrame();\n" +
        "  const { fps } = useVideoConfig();\n" +
        "  const dashOff = interpolate(frame, [0, 60], [400, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });\n" +
        "  const txtOp = interpolate(frame, [30, 60], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });\n" +
        "  const txtY = interpolate(frame, [30, 60], [20, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });\n" +
        "  return (\n" +
        "    <AbsoluteFill style={{ backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>\n" +
        "      <svg width=\"220\" height=\"220\" viewBox=\"0 0 220 220\" style={{ position: 'absolute' }}>\n" +
        "        <circle cx=\"110\" cy=\"110\" r=\"100\" stroke={accent} strokeWidth=\"6\" fill=\"none\" strokeDasharray=\"630\" strokeDashoffset={dashOff} strokeLinecap=\"round\" transform=\"rotate(-90 110 110)\"/>\n" +
        "      </svg>\n" +
        "      <div style={{ fontFamily: 'Inter, system-ui, sans-serif', fontSize: 64, fontWeight: 800, color: '#f8fafc', letterSpacing: 4, textTransform: 'uppercase', opacity: txtOp, transform: `translateY(${txtY}px)` }}>{brand}</div>\n" +
        "    </AbsoluteFill>\n" +
        "  );\n" +
        "}\n";
}

function spectrumVisualizer(): string {
    return header() +
        "type P = { accent: string; bg: string; bars: number };\n" +
        "export default function SpectrumVisualizer({ accent, bg, bars }: P) {\n" +
        "  const frame = useCurrentFrame();\n" +
        "  const n = Math.max(8, Math.min(64, bars));\n" +
        "  return (\n" +
        "    <AbsoluteFill style={{ backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>\n" +
        "      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 600, width: 1000 }}>\n" +
        "        {Array.from({ length: n }).map((_, i) => {\n" +
        "          const seed = ((i * 9301 + 49297) % 233280) / 233280;\n" +
        "          const speed = 0.04 + seed * 0.06;\n" +
        "          const h = (Math.sin(frame * speed + i * 0.7) * 0.5 + 0.5) * 600;\n" +
        "          return <div key={i} style={{ width: (1000 / n) - 6, height: h, background: 'linear-gradient(180deg, ' + accent + ' 0%, rgba(0,0,0,0) 100%)', borderRadius: 4 }} />;\n" +
        "        })}\n" +
        "      </div>\n" +
        "    </AbsoluteFill>\n" +
        "  );\n" +
        "}\n";
}

function confettiBurst(): string {
    return header() +
        "type P = { accent: string; bg: string };\n" +
        "export default function Confetti({ accent, bg }: P) {\n" +
        "  const frame = useCurrentFrame();\n" +
        "  const N = 40;\n" +
        "  const colours = [accent, '#f8fafc', '#fbbf24', '#34d399', '#f472b6'];\n" +
        "  return (\n" +
        "    <AbsoluteFill style={{ backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>\n" +
        "      <svg width=\"1080\" height=\"1080\" viewBox=\"0 0 1080 1080\" style={{ position: 'absolute', inset: 0 }}>\n" +
        "        {Array.from({ length: N }).map((_, i) => {\n" +
        "          const ang = (i / N) * Math.PI * 2;\n" +
        "          const sp = 6 + (i % 5) * 1.4;\n" +
        "          const x = 540 + Math.cos(ang) * sp * frame;\n" +
        "          const y = 540 + Math.sin(ang) * sp * frame + 0.25 * frame * frame;\n" +
        "          const rot = frame * (4 + (i % 3));\n" +
        "          const colour = colours[i % colours.length];\n" +
        "          const op = interpolate(frame, [60, 90], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });\n" +
        "          return <rect key={i} x={x - 6} y={y - 3} width=\"12\" height=\"6\" fill={colour} opacity={op} transform={`rotate(${rot} ${x} ${y})`} />;\n" +
        "        })}\n" +
        "      </svg>\n" +
        "    </AbsoluteFill>\n" +
        "  );\n" +
        "}\n";
}

/**
 * Small helper: every builder is a list of TSX lines so the templates stay
 * readable here. Double-quoted TS strings mean backticks and `${}` inside the
 * generated TSX stay literal — no escaping gymnastics.
 */
function tsx(...lines: string[]): string {
    return header() + lines.join('\n') + '\n';
}

function statCounter(): string {
    return tsx(
        "type P = { label: string; value: number; suffix: string; accent: string; bg: string };",
        "export default function StatCounter({ label, value, suffix, accent, bg }: P) {",
        "  const frame = useCurrentFrame();",
        "  const { fps } = useVideoConfig();",
        "  const p = spring({ frame, fps, config: { damping: 200 } });",
        "  const n = Math.round(interpolate(p, [0, 1], [0, value]));",
        "  return (",
        "    <AbsoluteFill style={{ backgroundColor: bg, justifyContent: 'center', alignItems: 'center', fontFamily: 'Inter, system-ui, sans-serif' }}>",
        "      <div style={{ fontSize: 190, fontWeight: 800, color: accent, lineHeight: 1 }}>{n}{suffix}</div>",
        "      <div style={{ fontSize: 38, color: '#94a3b8', marginTop: 20, letterSpacing: 5, textTransform: 'uppercase' }}>{label}</div>",
        "    </AbsoluteFill>",
        "  );",
        "}",
    );
}

function quoteCard(): string {
    return tsx(
        "type P = { quote: string; author: string; role: string; accent: string; bg: string };",
        "export default function QuoteCard({ quote, author, role, accent, bg }: P) {",
        "  const frame = useCurrentFrame();",
        "  const { fps } = useVideoConfig();",
        "  const s = spring({ frame, fps, config: { damping: 16, mass: 0.7 } });",
        "  const op = interpolate(frame, [0, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });",
        "  return (",
        "    <AbsoluteFill style={{ backgroundColor: bg, justifyContent: 'center', padding: 120, fontFamily: 'Georgia, serif' }}>",
        "      <div style={{ transform: `scale(${0.94 + s * 0.06})`, opacity: op }}>",
        "        <div style={{ fontSize: 110, color: accent, lineHeight: 1 }}>{'\u201C'}</div>",
        "        <div style={{ fontSize: 58, color: '#f1f5f9', lineHeight: 1.35, marginTop: -20 }}>{quote}</div>",
        "        <div style={{ marginTop: 48, display: 'flex', alignItems: 'center', gap: 20, fontFamily: 'Inter, system-ui, sans-serif' }}>",
        "          <div style={{ width: 6, height: 56, background: accent, borderRadius: 3 }} />",
        "          <div>",
        "            <div style={{ fontSize: 34, color: '#f8fafc', fontWeight: 600 }}>{author}</div>",
        "            <div style={{ fontSize: 24, color: '#94a3b8', marginTop: 4 }}>{role}</div>",
        "          </div>",
        "        </div>",
        "      </div>",
        "    </AbsoluteFill>",
        "  );",
        "}",
    );
}

function splitScreen(): string {
    return tsx(
        "type P = { left: string; right: string; leftLabel: string; rightLabel: string; accent: string; bg: string };",
        "export default function SplitScreen({ left, right, leftLabel, rightLabel, accent, bg }: P) {",
        "  const frame = useCurrentFrame();",
        "  const wipe = interpolate(frame, [10, 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });",
        "  return (",
        "    <AbsoluteFill style={{ backgroundColor: bg, fontFamily: 'Inter, system-ui, sans-serif' }}>",
        "      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', background: '#0b1220' }}>",
        "        <div style={{ fontSize: 62, color: '#e2e8f0', fontWeight: 700 }}>{left}</div>",
        "        <div style={{ fontSize: 26, color: '#64748b', marginTop: 14, letterSpacing: 3 }}>{leftLabel}</div>",
        "      </AbsoluteFill>",
        "      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', background: '#111c2e', clipPath: `inset(0 0 0 ${wipe * 50}%)` }}>",
        "        <div style={{ fontSize: 62, color: '#f8fafc', fontWeight: 700 }}>{right}</div>",
        "        <div style={{ fontSize: 26, color: accent, marginTop: 14, letterSpacing: 3 }}>{rightLabel}</div>",
        "      </AbsoluteFill>",
        "      <div style={{ position: 'absolute', left: `${wipe * 50}%`, top: 0, bottom: 0, width: 4, background: accent }} />",
        "    </AbsoluteFill>",
        "  );",
        "}",
    );
}

function typewriter(): string {
    return tsx(
        "type P = { text: string; accent: string; bg: string };",
        "export default function Typewriter({ text, accent, bg }: P) {",
        "  const frame = useCurrentFrame();",
        "  const { fps, durationInFrames } = useVideoConfig();",
        "  const total = text.length;",
        "  const shown = Math.min(total, Math.floor(interpolate(frame, [0, durationInFrames * 0.8], [0, total], { extrapolateRight: 'clamp' })));",
        "  const blink = Math.floor(frame / Math.max(1, Math.round(fps / 2))) % 2 === 0;",
        "  return (",
        "    <AbsoluteFill style={{ backgroundColor: bg, justifyContent: 'center', padding: 110, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>",
        "      <div style={{ fontSize: 60, color: '#e2e8f0', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>",
        "        {text.slice(0, shown)}",
        "        <span style={{ color: accent, opacity: blink ? 1 : 0 }}>{'\u2588'}</span>",
        "      </div>",
        "    </AbsoluteFill>",
        "  );",
        "}",
    );
}

function timeline(): string {
    return tsx(
        "type P = { title: string; milestones: { label: string; value: string }[]; accent: string; bg: string };",
        "export default function Timeline({ title, milestones, accent, bg }: P) {",
        "  const frame = useCurrentFrame();",
        "  const { fps } = useVideoConfig();",
        "  return (",
        "    <AbsoluteFill style={{ backgroundColor: bg, padding: 110, fontFamily: 'Inter, system-ui, sans-serif' }}>",
        "      <div style={{ fontSize: 52, color: '#f8fafc', fontWeight: 700, marginBottom: 70 }}>{title}</div>",
        "      <div style={{ position: 'relative', paddingLeft: 56 }}>",
        "        <div style={{ position: 'absolute', left: 12, top: 10, bottom: 10, width: 3, background: '#1e293b' }} />",
        "        {milestones.map((m, i) => {",
        "          const s = spring({ frame: frame - i * 8, fps, config: { damping: 18 } });",
        "          return (",
        "            <div key={i} style={{ display: 'flex', gap: 34, marginBottom: 46, opacity: s, transform: `translateX(${(1 - s) * -30}px)` }}>",
        "              <div style={{ width: 26, height: 26, borderRadius: 13, background: accent, marginTop: 8, flexShrink: 0 }} />",
        "              <div>",
        "                <div style={{ fontSize: 40, color: '#f1f5f9', fontWeight: 600 }}>{m.label}</div>",
        "                <div style={{ fontSize: 26, color: '#94a3b8', marginTop: 6 }}>{m.value}</div>",
        "              </div>",
        "            </div>",
        "          );",
        "        })}",
        "      </div>",
        "    </AbsoluteFill>",
        "  );",
        "}",
    );
}

function listReveal(): string {
    return tsx(
        "type P = { title: string; items: string[]; accent: string; bg: string };",
        "export default function ListReveal({ title, items, accent, bg }: P) {",
        "  const frame = useCurrentFrame();",
        "  const { fps } = useVideoConfig();",
        "  return (",
        "    <AbsoluteFill style={{ backgroundColor: bg, padding: 110, fontFamily: 'Inter, system-ui, sans-serif' }}>",
        "      <div style={{ fontSize: 56, color: '#f8fafc', fontWeight: 700, marginBottom: 56 }}>{title}</div>",
        "      {items.map((item, i) => {",
        "        const s = spring({ frame: frame - 10 - i * 10, fps, config: { damping: 17 } });",
        "        return (",
        "          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 34, opacity: s, transform: `translateY(${(1 - s) * 24}px)` }}>",
        "            <div style={{ width: 12, height: 12, borderRadius: 6, background: accent, flexShrink: 0 }} />",
        "            <div style={{ fontSize: 42, color: '#e2e8f0' }}>{item}</div>",
        "          </div>",
        "        );",
        "      })}",
        "    </AbsoluteFill>",
        "  );",
        "}",
    );
}

function waveform(): string {
    return tsx(
        "type P = { accent: string; bg: string; bars: number };",
        "export default function Waveform({ accent, bg, bars }: P) {",
        "  const frame = useCurrentFrame();",
        "  const n = Math.max(8, Math.min(96, bars));",
        "  const arr = Array.from({ length: n });",
        "  return (",
        "    <AbsoluteFill style={{ backgroundColor: bg, justifyContent: 'center', alignItems: 'center' }}>",
        "      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 420 }}>",
        "        {arr.map((_, i) => {",
        "          const h = 40 + Math.abs(Math.sin((frame + i * 7) * 0.12 + i)) * 340;",
        "          return <div key={i} style={{ width: 12, height: h, background: accent, borderRadius: 6, opacity: 0.35 + (h / 420) * 0.65 }} />;",
        "        })}",
        "      </div>",
        "    </AbsoluteFill>",
        "  );",
        "}",
    );
}

function glitchTitle(): string {
    return tsx(
        "type P = { text: string; accent: string; bg: string };",
        "export default function GlitchTitle({ text, accent, bg }: P) {",
        "  const frame = useCurrentFrame();",
        "  const glitch = frame < 26 ? (frame % 6 < 3 ? 1 : -1) * (26 - frame) * 1.4 : 0;",
        "  const settle = interpolate(frame, [26, 46], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });",
        "  return (",
        "    <AbsoluteFill style={{ backgroundColor: bg, justifyContent: 'center', alignItems: 'center', fontFamily: 'Inter, system-ui, sans-serif' }}>",
        "      <div style={{ position: 'relative' }}>",
        "        <div style={{ position: 'absolute', fontSize: 130, fontWeight: 800, color: '#ef4444', transform: `translate(${glitch}px, ${-glitch * 0.4}px)`, opacity: 0.75 * settle + (frame < 26 ? 0.75 : 0) }}>{text}</div>",
        "        <div style={{ position: 'absolute', fontSize: 130, fontWeight: 800, color: '#22d3ee', transform: `translate(${-glitch}px, ${glitch * 0.4}px)`, opacity: 0.75 * settle + (frame < 26 ? 0.75 : 0) }}>{text}</div>",
        "        <div style={{ fontSize: 130, fontWeight: 800, color: '#f8fafc', letterSpacing: -2 }}>{text}</div>",
        "      </div>",
        "      <div style={{ width: 180, height: 5, background: accent, marginTop: 40, borderRadius: 3 }} />",
        "    </AbsoluteFill>",
        "  );",
        "}",
    );
}

function testimonial(): string {
    return tsx(
        "type P = { quote: string; name: string; role: string; initials: string; accent: string; bg: string };",
        "export default function Testimonial({ quote, name, role, initials, accent, bg }: P) {",
        "  const frame = useCurrentFrame();",
        "  const { fps } = useVideoConfig();",
        "  const s = spring({ frame, fps, config: { damping: 18 } });",
        "  return (",
        "    <AbsoluteFill style={{ backgroundColor: bg, justifyContent: 'center', alignItems: 'center', fontFamily: 'Inter, system-ui, sans-serif' }}>",
        "      <div style={{ width: 860, background: '#0f172a', borderRadius: 28, padding: 72, transform: `translateY(${(1 - s) * 40}px)`, opacity: s }}>",
        "        <div style={{ display: 'flex', alignItems: 'center', gap: 26, marginBottom: 36 }}>",
        "          <div style={{ width: 78, height: 78, borderRadius: 39, background: accent, color: '#06121f', fontSize: 32, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initials}</div>",
        "          <div>",
        "            <div style={{ fontSize: 34, color: '#f8fafc', fontWeight: 600 }}>{name}</div>",
        "            <div style={{ fontSize: 24, color: '#94a3b8', marginTop: 4 }}>{role}</div>",
        "          </div>",
        "        </div>",
        "        <div style={{ fontSize: 38, color: '#e2e8f0', lineHeight: 1.45, fontStyle: 'italic' }}>{'\u201C'}{quote}{'\u201D'}</div>",
        "      </div>",
        "    </AbsoluteFill>",
        "  );",
        "}",
    );
}

function productCard(): string {
    return tsx(
        "type P = { product: string; price: string; features: string[]; accent: string; bg: string };",
        "export default function ProductCard({ product, price, features, accent, bg }: P) {",
        "  const frame = useCurrentFrame();",
        "  const { fps } = useVideoConfig();",
        "  const s = spring({ frame, fps, config: { damping: 16, mass: 0.8 } });",
        "  return (",
        "    <AbsoluteFill style={{ backgroundColor: bg, justifyContent: 'center', alignItems: 'center', fontFamily: 'Inter, system-ui, sans-serif' }}>",
        "      <div style={{ width: 820, background: '#0f172a', borderRadius: 30, padding: 68, borderTop: `8px solid ${accent}`, transform: `scale(${0.92 + s * 0.08})`, opacity: s }}>",
        "        <div style={{ fontSize: 30, color: accent, letterSpacing: 5, textTransform: 'uppercase' }}>New</div>",
        "        <div style={{ fontSize: 66, color: '#f8fafc', fontWeight: 800, marginTop: 16 }}>{product}</div>",
        "        <div style={{ fontSize: 54, color: accent, fontWeight: 700, marginTop: 12 }}>{price}</div>",
        "        <div style={{ marginTop: 40 }}>",
        "          {features.map((f, i) => {",
        "            const fs = spring({ frame: frame - 20 - i * 8, fps, config: { damping: 18 } });",
        "            return (",
        "              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 20, opacity: fs, transform: `translateX(${(1 - fs) * -20}px)` }}>",
        "                <div style={{ color: accent, fontSize: 30 }}>{'\u2713'}</div>",
        "                <div style={{ fontSize: 34, color: '#cbd5e1' }}>{f}</div>",
        "              </div>",
        "            );",
        "          })}",
        "        </div>",
        "      </div>",
        "    </AbsoluteFill>",
        "  );",
        "}",
    );
}

export const TEMPLATES: Record<string, { defaults: Record<string, unknown>; build: () => string }> = {
    'lower-third': { defaults: { name: 'Jamie Pine', title: 'Voicebox author', accent: '#38bdf8', bg: '#06121f' }, build: lowerThird },
    'title-card': { defaults: { line1: 'Ocean', line2: 'Plastic', accent: '#38bdf8', bg: '#06121f' }, build: titleCard },
    'end-cta': { defaults: { headline: 'Thanks for watching', subline: 'See you in the next one', cta: 'Subscribe', accent: '#38bdf8', bg: '#06121f' }, build: endCta },
    'countdown': { defaults: { from: 10, accent: '#38bdf8', bg: '#06121f' }, build: countdown },
    'progress-bar': { defaults: { label: 'Loading', percent: 75, accent: '#38bdf8', bg: '#06121f' }, build: progressBar },
    'kinetic-text': { defaults: { words: ['Make', 'your', 'voice', 'heard'], accent: '#38bdf8', bg: '#06121f' }, build: kineticText },
    'bar-chart-infographic': { defaults: { title: 'Quarterly growth', bars: [{ label: 'Q1', value: 32 }, { label: 'Q2', value: 58 }, { label: 'Q3', value: 47 }, { label: 'Q4', value: 81 }], accent: '#38bdf8', bg: '#06121f' }, build: barChartInfographic },
    'logo-reveal': { defaults: { brand: 'VIDEFORGE', accent: '#38bdf8', bg: '#06121f' }, build: logoReveal },
    'spectrum-visualizer': { defaults: { accent: '#38bdf8', bg: '#06121f', bars: 32 }, build: spectrumVisualizer },
    'confetti': { defaults: { accent: '#38bdf8', bg: '#06121f' }, build: confettiBurst },
    'stat-counter': { defaults: { label: 'Videos rendered', value: 128, suffix: 'k', accent: '#38bdf8', bg: '#06121f' }, build: statCounter },
    'quote-card': { defaults: { quote: 'The best way to predict the future is to invent it.', author: 'Alan Kay', role: 'Computer scientist', accent: '#38bdf8', bg: '#06121f' }, build: quoteCard },
    'split-screen': { defaults: { left: 'Before', right: 'After', leftLabel: 'THEN', rightLabel: 'NOW', accent: '#38bdf8', bg: '#06121f' }, build: splitScreen },
    'typewriter': { defaults: { text: 'This text types itself out, one character at a time.', accent: '#38bdf8', bg: '#06121f' }, build: typewriter },
    'timeline': { defaults: { title: 'How we got here', milestones: [{ label: 'Started', value: 'March 2026' }, { label: 'First release', value: 'June 2026' }, { label: 'v1.0', value: 'September 2026' }], accent: '#38bdf8', bg: '#06121f' }, build: timeline },
    'list-reveal': { defaults: { title: 'What you get', items: ['124 plugins', 'No orchestrator', 'Explicit failures'], accent: '#38bdf8', bg: '#06121f' }, build: listReveal },
    'waveform': { defaults: { accent: '#38bdf8', bg: '#06121f', bars: 40 }, build: waveform },
    'glitch-title': { defaults: { text: 'AGENTIC', accent: '#38bdf8', bg: '#06121f' }, build: glitchTitle },
    'testimonial': { defaults: { quote: 'It never silently swapped a provider on me. That is the whole point.', name: 'Jamie Pine', role: 'Platform engineer', initials: 'JP', accent: '#38bdf8', bg: '#06121f' }, build: testimonial },
    'product-card': { defaults: { product: 'Studio Plan', price: '$19/mo', features: ['Unlimited renders', '4K export', 'No watermark'], accent: '#38bdf8', bg: '#06121f' }, build: productCard },
};

export const TEMPLATE_NAMES = Object.keys(TEMPLATES);
