import { useState, useEffect } from 'react';
import { FileUpload } from './components/FileUpload';
import { TextDisplay } from './components/TextDisplay';
import { SettingsPanel } from './components/SettingsPanel';
import type { TranslatorConfig } from './types';

const SETTINGS_KEY = 'translator_settings';

function loadSettings(): TranslatorConfig {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // Ignore errors
  }
  return { provider: 'mymemory' };
}

function saveSettings(config: TranslatorConfig) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(config));
  } catch {
    // Ignore errors
  }
}

function App() {
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [config, setConfig] = useState<TranslatorConfig>(loadSettings);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    saveSettings(config);
  }, [config]);

  const handleTextLoaded = (loadedText: string, name: string) => {
    setText(loadedText);
    setFileName(name);
  };

  const handleReset = () => {
    setText(null);
    setFileName(null);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl font-semibold text-gray-900">
            Language Reader
          </h1>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md"
            title="Settings"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        {!text ? (
          <div className="space-y-6">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-medium text-gray-800 mb-2">
                Upload a text in French or Thai
              </h2>
              <p className="text-gray-600">
                Click on any word to see its English translation
              </p>
            </div>
            <FileUpload onTextLoaded={handleTextLoaded} />
          </div>
        ) : (
          <div>
            {/* File info and reset button */}
            <div className="flex justify-between items-center mb-6 pb-4 border-b">
              <div className="text-sm text-gray-600">
                Reading: <span className="font-medium">{fileName}</span>
              </div>
              <button
                onClick={handleReset}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md"
              >
                Upload different file
              </button>
            </div>

            {/* Text display */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <TextDisplay text={text} config={config} />
            </div>
          </div>
        )}
      </main>

      {/* Settings panel */}
      <SettingsPanel
        config={config}
        onConfigChange={setConfig}
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}

export default App;
