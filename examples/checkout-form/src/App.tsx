import React from 'react';
import { CheckoutForm } from './CheckoutForm';
import { graph, coverage } from '@veriscope/graph';
import { mountDevtools } from '@veriscope/devtools';
import { explore } from '@veriscope/test';
import '@veriscope/devtools/bridge';
// @ts-ignore — Vite ?raw import
import checkoutSource from './CheckoutForm.tsx?raw';

function SourceViewer({ source, filename }: { source: string; filename: string }) {
  const [open, setOpen] = React.useState(false);

  return (
    <details open={open} onToggle={e => setOpen((e.target as HTMLDetailsElement).open)} style={{ margin: '16px 0' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem', color: '#c9d1d9', userSelect: 'none' }}>
        {open ? '▼' : '▶'} {filename}
      </summary>
      <pre style={{
        background: '#0d1117',
        color: '#c9d1d9',
        padding: 16,
        borderRadius: 6,
        border: '1px solid #30363d',
        overflow: 'auto',
        maxHeight: 500,
        fontSize: '0.78rem',
        lineHeight: 1.5,
        fontFamily: '"SF Mono", "Fira Code", monospace',
        marginTop: 8,
      }}>
        <code>{highlightTsx(source)}</code>
      </pre>
    </details>
  );
}

function highlightTsx(source: string): React.ReactNode[] {
  const lines = source.split('\n');
  return lines.map((line, i) => {
    const parts: React.ReactNode[] = [];
    let remaining = line;
    let key = 0;

    // Simple regex-based highlighting
    const patterns: Array<[RegExp, string]> = [
      [/\/\/.*$/, '#6a737d'],           // comments
      [/'[^']*'|"[^"]*"|`[^`]*`/, '#a5d6ff'], // strings
      [/\b(import|from|export|function|const|let|return|if|else|for|of|type|interface|new|async|await|typeof)\b/, '#ff7b72'], // keywords
      [/\b(true|false|null|undefined|void)\b/, '#79c0ff'], // literals
      [/\b(useSignal|useDerived|useEdgeEffect|assertAlways|assertNever|assertAfter|useEffect|useRef|useState|useCallback)\b/, '#d2a8ff'], // hooks/API
      [/\b\d+\b/, '#79c0ff'], // numbers
    ];

    // Apply highlights line by line — simple approach
    const lineNum = String(i + 1).padStart(3, ' ');
    parts.push(<span key={`ln${i}`} style={{ color: '#484f58', marginRight: 16 }}>{lineNum}</span>);

    // Tokenize the line
    let pos = 0;
    while (pos < remaining.length) {
      let matched = false;
      for (const [pattern, color] of patterns) {
        const m = remaining.slice(pos).match(pattern);
        if (m && m.index === 0) {
          parts.push(<span key={key++} style={{ color }}>{m[0]}</span>);
          pos += m[0].length;
          matched = true;
          break;
        }
      }
      if (!matched) {
        // Collect plain text
        let end = pos + 1;
        while (end < remaining.length) {
          let anyMatch = false;
          for (const [pattern] of patterns) {
            const m = remaining.slice(end).match(pattern);
            if (m && m.index === 0) { anyMatch = true; break; }
          }
          if (anyMatch) break;
          end++;
        }
        parts.push(<span key={key++}>{remaining.slice(pos, end)}</span>);
        pos = end;
      }
    }

    return <React.Fragment key={i}>{parts}{'\n'}</React.Fragment>;
  });
}

export function App() {
  const devtoolsRef = React.useRef<HTMLDivElement>(null);
  const handleRef = React.useRef<ReturnType<typeof mountDevtools> | null>(null);

  React.useEffect(() => {
    if (devtoolsRef.current && !handleRef.current) {
      graph.enableCoverage();
      graph.startRecording();
      handleRef.current = mountDevtools(devtoolsRef.current, graph, {
        height: '360px',
        coverage,
        explore,
      });
    }
    return () => {
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, []);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 20 }}>
      <h1>Veriscope Ship Gate: Checkout Form</h1>
      <p>
        8 tracked signals, 4 derived values, 5 assertions, 1 edge effect.
        Open the devtools panel below to see the live waveform, dependency graph, and assertion status.
      </p>
      <CheckoutForm />
      <SourceViewer source={checkoutSource} filename="CheckoutForm.tsx" />
      <hr style={{ margin: '20px 0' }} />
      <h3>Devtools</h3>
      <div ref={devtoolsRef} style={{ width: '100%' }} />
    </div>
  );
}
