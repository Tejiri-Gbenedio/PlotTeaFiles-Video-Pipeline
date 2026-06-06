'use client';

import {useEffect, useMemo, useState} from 'react';
import {Download, FileJson, Film, Play, RefreshCw, Sparkles} from 'lucide-react';

type JobStatus = 'queued' | 'running' | 'done' | 'failed';

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

const sampleScript = {
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

function statusLabel(status: JobStatus): string {
  if (status === 'queued') return 'Queued';
  if (status === 'running') return 'Rendering';
  if (status === 'done') return 'Ready';
  return 'Failed';
}

export default function StudioPage() {
  const [script, setScript] = useState(() => JSON.stringify(sampleScript, null, 2));
  const [provider, setProvider] = useState('openai');
  const [quality, setQuality] = useState('low');
  const [shots, setShots] = useState(3);
  const [jobs, setJobs] = useState<StudioJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const latestJob = jobs[0];
  const canSubmit = useMemo(() => script.trim().length > 0 && !busy, [busy, script]);

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

  async function submitJob() {
    setBusy(true);
    setError(undefined);

    try {
      const parsed = JSON.parse(script) as unknown;
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          script: parsed,
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
            Phase 3 Studio MVP
          </div>
        </header>

        <section className="grid">
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <FileJson size={18} />
                Story Script
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
                  <label>Output Mode</label>
                  <input className="input" disabled value="MP4 render job" />
                </div>
                <div className="field full">
                  <label>Script JSON</label>
                  <textarea className="textarea" value={script} onChange={(event) => setScript(event.target.value)} />
                </div>
              </div>

              <div className="actions">
                <button className="button primary" disabled={!canSubmit} onClick={submitJob}>
                  <Play size={18} />
                  Generate Video
                </button>
                <button className="button secondary" onClick={() => setScript(JSON.stringify(sampleScript, null, 2))}>
                  <RefreshCw size={17} />
                  Reset Sample
                </button>
              </div>

              {error ? <div className="error">{error}</div> : null}
              <p className="note">
                Hosted mode stores secrets in server-side environment variables only. Local mode can reuse the CLI
                pipeline already built in this repo.
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
