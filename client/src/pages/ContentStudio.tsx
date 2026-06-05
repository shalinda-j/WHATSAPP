import { useEffect, useState } from 'react';
import { api } from '../config';
import {
  Wand2,
  Image as ImageIcon,
  Trash2,
  RefreshCw,
  AlertTriangle,
  Sparkles,
  Download,
  CheckCircle2,
} from 'lucide-react';

interface Provider {
  name: string;
  defaultModel: string;
  ready: boolean;
  missing: string[];
}

interface Asset {
  _id: string;
  type: 'image' | 'video' | 'audio';
  provider: string;
  modelName?: string;
  prompt: string;
  size?: string;
  url?: string;
  inlineBase64?: string;
  status: 'pending' | 'ready' | 'failed';
  errorMessage?: string;
  costUsd?: number;
  createdAt: string;
}

const SIZE_OPTIONS = [
  { value: 'square', label: 'Square (1:1)' },
  { value: 'landscape', label: 'Landscape (16:9)' },
  { value: 'portrait', label: 'Portrait (9:16)' },
];

const PROMPT_TEMPLATES = [
  'Studio product shot of {product} on a clean white background, soft lighting, 4k',
  'Vibrant Instagram-ready flatlay featuring {product}, top-down view',
  'Holiday season banner for {brand} with festive elements, brand colours',
  'Customer testimonial graphic with bold pull-quote, modern minimal style',
];

export default function ContentStudio() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [size, setSize] = useState<string>('square');
  const [provider, setProvider] = useState<string>('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [provRes, assetsRes] = await Promise.all([
        api.get<{ providers: Provider[] }>('/api/content/providers'),
        api.get<{ assets: Asset[] }>('/api/content/assets?type=image'),
      ]);
      setProviders(provRes.data.providers);
      setAssets(assetsRes.data.assets);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const readyProviders = providers.filter((p) => p.ready);
  const anyReady = readyProviders.length > 0;

  const generate = async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await api.post<{ asset: Asset }>(
        '/api/content/image/generate',
        {
          prompt: prompt.trim(),
          negativePrompt: negativePrompt.trim() || undefined,
          size,
          provider: provider || undefined,
        },
      );
      setAssets((prev) => [res.data.asset, ...prev]);
    } catch (err) {
      const ax = err as {
        response?: { data?: { error?: string; asset?: Asset } };
      };
      setError(
        ax.response?.data?.error ||
          (err instanceof Error ? err.message : 'Generation failed'),
      );
      if (ax.response?.data?.asset) {
        setAssets((prev) => [ax.response!.data!.asset!, ...prev]);
      }
    } finally {
      setGenerating(false);
    }
  };

  const removeAsset = async (id: string) => {
    if (!window.confirm('Delete this asset?')) return;
    try {
      await api.delete(`/api/content/assets/${id}`);
      setAssets((prev) => prev.filter((a) => a._id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const srcFor = (a: Asset): string | null => {
    if (a.url) return a.url;
    if (a.inlineBase64) return `data:image/png;base64,${a.inlineBase64}`;
    return null;
  };

  return (
    <div>
      <header className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Wand2 className="h-6 w-6 text-purple-600" /> Content Studio
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Generate brand images for campaigns, posts and acknowledgements.
            Picks the right provider based on your configured API keys.
          </p>
        </div>
        <button
          onClick={load}
          className="text-sm flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-md bg-white hover:bg-gray-50"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </header>

      {/* Provider readiness banner */}
      <section className="mb-5 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-purple-600" /> Providers
        </h2>
        <div className="flex flex-wrap gap-2">
          {providers.length === 0 ? (
            <span className="text-xs text-gray-500">Loading…</span>
          ) : (
            providers.map((p) => (
              <div
                key={p.name}
                className={`text-xs px-2.5 py-1.5 rounded-md border flex items-center gap-1.5 ${
                  p.ready
                    ? 'bg-green-50 border-green-200 text-green-800'
                    : 'bg-amber-50 border-amber-200 text-amber-800'
                }`}
                title={
                  p.ready
                    ? `Default model: ${p.defaultModel}`
                    : `Missing: ${p.missing.join(', ')}`
                }
              >
                {p.ready ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5" />
                )}
                <span className="font-medium capitalize">{p.name}</span>
                <span className="text-[10px] opacity-70">
                  {p.ready ? p.defaultModel : `set ${p.missing.join(' + ')}`}
                </span>
              </div>
            ))
          )}
        </div>
        {!anyReady && providers.length > 0 && (
          <p className="mt-2 text-xs text-amber-700">
            No image-gen provider configured. Set <code>OPENAI_API_KEY</code> or{' '}
            <code>STABILITY_API_KEY</code> in the server environment to enable
            generation.
          </p>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Composer */}
        <section className="lg:col-span-1 rounded-lg border border-gray-200 bg-white p-4 h-fit">
          <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
            New image
          </h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Prompt</label>
              <textarea
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Studio product shot of a stainless-steel kettle on a marble counter, soft window light"
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
              />
              <div className="mt-1.5 flex flex-wrap gap-1">
                {PROMPT_TEMPLATES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setPrompt(t)}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
                  >
                    {t.slice(0, 36)}…
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                Avoid (negative prompt — optional)
              </label>
              <input
                type="text"
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                placeholder="blurry, low quality, text artifacts"
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Size</label>
                <select
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-sm bg-white"
                >
                  {SIZE_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  Provider
                </label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-sm bg-white"
                >
                  <option value="">Auto</option>
                  {providers.map((p) => (
                    <option key={p.name} value={p.name} disabled={!p.ready}>
                      {p.name}
                      {!p.ready ? ' (not ready)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {error && (
              <div className="rounded-md bg-red-50 ring-1 ring-red-200 text-red-700 px-3 py-2 text-xs">
                {error}
              </div>
            )}
            <button
              onClick={generate}
              disabled={generating || !prompt.trim()}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 disabled:opacity-50"
            >
              {generating ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" /> Generating…
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4" /> Generate image
                </>
              )}
            </button>
          </div>
        </section>

        {/* Gallery */}
        <section className="lg:col-span-2 rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              Gallery
            </h2>
            <span className="text-xs text-gray-500">
              {assets.length} {assets.length === 1 ? 'asset' : 'assets'}
            </span>
          </div>
          {loading ? (
            <div className="text-gray-500 text-sm">Loading…</div>
          ) : assets.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-gray-200 rounded-md">
              <ImageIcon className="h-10 w-10 mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-600 font-medium">
                No assets generated yet
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Write a prompt on the left and hit <em>Generate image</em>.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {assets.map((a) => {
                const src = srcFor(a);
                return (
                  <div
                    key={a._id}
                    className="rounded-md border border-gray-200 overflow-hidden bg-gray-50 group"
                  >
                    <div className="relative aspect-square bg-gradient-to-br from-purple-100 to-pink-100 flex items-center justify-center">
                      {a.status === 'pending' && (
                        <RefreshCw className="h-6 w-6 text-purple-500 animate-spin" />
                      )}
                      {a.status === 'failed' && (
                        <div className="text-center px-3">
                          <AlertTriangle className="h-6 w-6 text-red-500 mx-auto mb-1" />
                          <p className="text-[10px] text-red-700">
                            {a.errorMessage || 'Generation failed'}
                          </p>
                        </div>
                      )}
                      {a.status === 'ready' && src && (
                        <img
                          src={src}
                          alt={a.prompt}
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                    <div className="p-2.5">
                      <p
                        className="text-xs text-gray-700 line-clamp-2"
                        title={a.prompt}
                      >
                        {a.prompt}
                      </p>
                      <div className="flex items-center justify-between mt-2 text-[10px] text-gray-500">
                        <span className="capitalize">
                          {a.provider}
                          {a.size ? ` · ${a.size}` : ''}
                          {typeof a.costUsd === 'number' && a.costUsd > 0
                            ? ` · $${a.costUsd.toFixed(3)}`
                            : ''}
                        </span>
                        <div className="flex items-center gap-1">
                          {src && a.status === 'ready' && (
                            <a
                              href={src}
                              download={`asset-${a._id}.png`}
                              className="text-gray-500 hover:text-gray-800"
                              title="Download"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </a>
                          )}
                          <button
                            onClick={() => removeAsset(a._id)}
                            className="text-red-500 hover:text-red-700"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
