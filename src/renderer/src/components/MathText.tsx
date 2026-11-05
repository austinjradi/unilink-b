import { useEffect, useRef } from 'react';

// KaTeX and its fonts only load once something on screen has math in it. Until then, or if they
// can't load (offline, before it was ever opened), the source still reads as what it is.
// Importing a CSS file with import() adds those styles to
// the page once it loads. Both imports run at the same time.
const load = () => Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([katex]) => katex.default);

export function MathText({ tex, block }: { tex: string; block: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    // The cleanup sets this to false. If tex changes or the component unmounts before KaTeX
    // arrives, the late result is ignored instead of being drawn into a stale element.
    let current = true;
    load()
      .then((katex) => {
        // Bad math shows in red rather than breaking the post. A post can't make it run anything or
        // load anything (no `trust`), and these limits stop one from taking over the page.
        // katex.render writes into the element directly, outside React.
        if (current && ref.current) katex.render(tex, ref.current, { displayMode: block, throwOnError: false, strict: false, maxSize: 20, maxExpand: 200 });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [tex, block]);
  return (
    // ref={ref} gives the effect this DOM element once it's
    // mounted. The raw source shows until KaTeX replaces it.
    <span ref={ref} style={block ? { display: 'block', overflowX: 'auto', margin: '6px 0' } : undefined}>
      {tex}
    </span>
  );
}
