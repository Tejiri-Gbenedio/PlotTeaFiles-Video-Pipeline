'use client';

import {useEffect, useMemo, useState} from 'react';
import {Code2, Download, FileText, Film, Play, RefreshCw, Sparkles, Wand2} from 'lucide-react';

type JobStatus = 'queued' | 'running' | 'done' | 'failed';
type InputMode = 'plain' | 'json';

interface StudioJob {
  id: string;
  title: string;
  status: JobStatus;
  stage: string;
  progress: number;
  createdAt: string;
  outputUrl?: string;
  error?: string;
}

const sampleStory = {
  id: 'closet-that-saved-her-life',
  title: 'The Closet That Saved Her Life',
  hook: 'She thought the closet was too small to save them.',
  segments: [
    {
      narration:
        'Maya heard the tornado siren while she was washing dishes, but the sky outside looked almost green.',
      broll_keyword: 'storm clouds tornado warning',
      effect: 'ken_burns'
    },
    {
      narration:
        'Her husband was still driving home, so she grabbed their six-year-old and ran to the hallway closet.',
      broll_keyword: 'family hallway closet',
      effect: 'zoom_in'
    },
    {
      narration:
        'Seconds later, every window in the house exploded inward and the roof started peeling away like paper.',
      broll_keyword: 'house tornado damage',
      effect: 'camera_shake'
    },
    {
      narration:
        'She pulled coats over their heads and told her daughter to sing so she would not hear the walls breaking.',
      broll_keyword: 'child shelter storm',
      effect: 'ken_burns'
    },
    {
      narration:
        'When the wind finally stopped, the closet was the only part of the hallway still standing.',
      broll_keyword: 'tornado aftermath survivor',
      effect: 'static'
    }
  ],
  outro: 'Sometimes survival is not loud. Sometimes it is one small door that holds.'
};

const samplePlainScript = [
  'Maya was washing dishes when the tornado siren started screaming across the neighborhood.',
  'At first, she thought it was another false alarm, but then she looked outside and saw the sky turning an impossible shade of green.',
  'Her husband was still driving home from work, so she grabbed their six-year-old daughter and ran toward the hallway closet.',
  'They barely got the door shut before every window in the house exploded inward.',
  'The roof began to peel away above them like paper. Maya pulled winter coats over their heads and told her daughter to sing anything she remembered from school.',
  'When the wind finally stopped, the hallway was gone. But the tiny closet was still standing.'
].join('\n\n');

function statusLabel(status: JobStatus): string {
  if (status === 'queued') return 'Queued';
  if (status === 'running') return 'Rendering';
  if (status === 'done') return 'Ready';
  return 'Failed';
}

export default function StudioPage() {
  const [mode, setMode] = useState<InputMode>('plain');
  const [plainScript, setPlainScript] = useState(samplePlainScript);
  const [title, setTitle] = useState('The Closet That Saved Her Life');
  const [targetSegments, setTargetSegments] = useState(5);
  const [tone, setTone] = useState('cinematic suspenseful');
  const [jsonScript, setJsonScript] = useState(() => JSON.stringify(sampleStory, null, 2));
  const [provider, setProvider] = useState('openai');
  const [quality, setQuality] = useState('low');
  const [shots, setShots] = useState(3);
  const [jobs, setJobs] = useState<StudioJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const latestJob = jobs[0];
  const canSubmit = useMemo(() => {
    if (busy || converting) return false;
    return mode === 'plain' ? plainScript.trim().length > 40 : jsonScript.trim().length > 0;
  }, [busy, converting, jsonScript, mode, plainScript]);

  async function loadJobs() {
    const response = await fetch('/api/jobs', {cache: 'no-store'});
    const data = (await response.json()) as {jobs: StudioJob[]};
    setJobs(data.jobs);
  }

  useEffect(() => {
    loadJobs().catch(() => undefined);
    const timer = window.setInterval(() => {
      loadJobs().catch(() => undefined);
    }, 3000);

    return () => window.clearInterval(timer);
  }, []);

  async function convertPlainScript() {
    setConverting(true);
    setError(undefined);

    try {
      const response = await fetch('/api/scripts/convert', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          plainScript,
          title: title.trim() || undefined,
          targetSegments,
          tone: tone.trim() || undefined
        })
      });
      const data = (await response.json()) as {story?: unknown; error?: string};

      if (!response.ok || !data.story) {
        throw new Error(data.error ?? 'Failed to convert plain script');
      }

      setJsonScript(JSON.stringify(data.story, null, 2));
      return data.story;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      throw caught;
    } finally {
      setConverting(false);
    }
  }

  async function submitJob() {
    setBusy(true);
    setError(undefined);

    try {
      const story = mode === 'plain' ? await convertPlainScript() : (JSON.parse(jsonScript) as unknown);
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          script: story,
          options: {
            provider,
            imageQuality: quality,
            shotsPerSegment: shots
          }
        })
      });
      const data = (await response.json()) as {error?: string};

      if (!response.ok) {
        throw new Error(data.error ?? 'Failed to create render job');
      }

      await loadJobs();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <h1>PlotTeaFiles Studio</h1>
            <span>Paste a story script, generate cinematic Shorts, download the MP4.</span>
          </div>
          <div className="status-pill">
            <Sparkles size={16} />
            Plain Script Mode
          </div>
        </header>

        <section className="grid">
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">
                {mode === 'plain' ? <FileText size={18} /> : <Code2 size={18} />}
                Script Input
              </div>
              <div className="tabs">
                <button className={mode === 'plain' ? 'tab active' : 'tab'} onClick={() => setMode('plain')}>
                  Plain Script
                </button>
                <button className={mode === 'json' ? 'tab active' : 'tab'} onClick={() => setMode('json')}>
                  Advanced JSON
                </button>
              </div>
            </div>
            <div className="panel-body">
              <div className="form-grid">
                <div className="field">
                  <label>Image Provider</label>
                  <select className="select" value={provider} onChange={(event) => setProvider(event.target.value)}>
                    <option value="openai">OpenAI</option>
                    <option value="gemini">Gemini with OpenAI fallback</option>
                  </select>
                </div>
                <div className="field">
                  <label>OpenAI Image Quality</label>
                  <select className="select" value={quality} onChange={(event) => setQuality(event.target.value)}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <div className="field">
                  <label>Shots Per Segment</label>
                  <input
                    className="input"
                    min={1}
                    max={6}
                    type="number"
                    value={shots}
                    onChange={(event) => setShots(Number(event.target.value))}
                  />
                </div>
                <div className="field">
                  <label>Target Segments</label>
                  <input
                    className="input"
                    disabled={mode === 'json'}
                    min={3}
                    max={8}
                    type="number"
                    value={targetSegments}
                    onChange={(event) => setTargetSegments(Number(event.target.value))}
                  />
                </div>

                {mode === 'plain' ? (
                  <>
                    <div className="field">
                      <label>Optional Title</label>
                      <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} />
                    </div>
                    <div className="field">
                      <label>Tone</label>
                      <input className="input" value={tone} onChange={(event) => setTone(event.target.value)} />
                    </div>
                    <div className="field full">
                      <label>Paste Normal Story Script</label>
                      <textarea
                        className="textarea plain"
                        value={plainScript}
                        onChange={(event) => setPlainScript(event.target.value)}
                      />
                    </div>
                  </>
                ) : (
                  <div className="field full">
                    <label>Internal StoryScript JSON</label>
                    <textarea
                      className="textarea"
                      value={jsonScript}
                      onChange={(event) => setJsonScript(event.target.value)}
                    />
                  </div>
                )}
              </div>

              <div className="actions">
                {mode === 'plain' ? (
                  <button className="button secondary" disabled={converting || busy} onClick={() => convertPlainScript()}>
                    <Wand2 size={18} />
                    {converting ? 'Converting...' : 'Convert Only'}
                  </button>
                ) : null}
                <button className="button primary" disabled={!canSubmit} onClick={submitJob}>
                  <Play size={18} />
                  {mode === 'plain' ? 'Generate From Script' : 'Generate From JSON'}
                </button>
                <button
                  className="button secondary"
                  onClick={() => {
                    setPlainScript(samplePlainScript);
                    setTitle(sampleStory.title);
                    setJsonScript(JSON.stringify(sampleStory, null, 2));
                  }}
                >
                  <RefreshCw size={17} />
                  Reset Sample
                </button>
              </div>

              {error ? <div className="error">{error}</div> : null}
              <p className="note">
                Plain Script Mode converts your pasted story into the internal video format automatically. Advanced JSON
                is still available when you want exact scene control.
              </p>
            </div>
          </div>

          <aside className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <Film size={18} />
                Render Jobs
              </div>
              <button className="button secondary" onClick={() => loadJobs()}>
                <RefreshCw size={16} />
              </button>
            </div>
            <div className="panel-body">
              <div className="jobs">
                {jobs.length === 0 ? <p className="note">No render jobs yet.</p> : null}
                {jobs.map((job) => (
                  <article className="job" key={job.id}>
                    <div className="job-top">
                      <div>
                        <h3>{job.title}</h3>
                        <p>{job.stage}</p>
                      </div>
                      <span className={`badge ${job.status}`}>{statusLabel(job.status)}</span>
                    </div>
                    <div className="progress" style={{'--value': `${job.progress}%`} as React.CSSProperties}>
                      <span />
                    </div>
                    {job.error ? <div className="error">{job.error}</div> : null}
                    {job.outputUrl ? (
                      <div className="job-actions">
                        <a className="button primary" href={job.outputUrl} download>
                          <Download size={17} />
                          Download MP4
                        </a>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
              {latestJob ? <p className="note">Latest job: {latestJob.id}</p> : null}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
