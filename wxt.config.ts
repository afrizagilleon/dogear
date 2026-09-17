import { defineConfig } from 'wxt';

const isRuntime = process.env.BUILD_TARGET === 'runtime'
  || process.argv.includes('runtime')
  || (process.argv.includes('-m') && process.argv[process.argv.indexOf('-m') + 1] === 'runtime')
  || (process.argv.includes('--mode') && process.argv[process.argv.indexOf('--mode') + 1] === 'runtime');

export default defineConfig({

  srcDir: 'extension',
  imports: false,
  manifestVersion: 3,
  outDirTemplate: isRuntime ? 'runtime' : '{{browser}}-mv{{manifestVersion}}',
  filterEntrypoints: isRuntime ? ['background'] : undefined,
  vite: () => ({
    define: {
      // Production builds always have this as `false` (dead-code eliminated by bundler).
      // Measurement script sets DISABLE_BACKOFF=1 to suppress onDisconnect backoff reconnects
      // so that chrome.alarms is the sole reconnect path for OQ-3 measurement (A2-T01).
      __MEASURE_DISABLE_BACKOFF__: process.env.DISABLE_BACKOFF === '1',
    },
  }),
  manifest: ({ browser }) => {
    // Izin nativeMessaging dan alarms (D-22, T-06, RQ-11)
    const permissions = ['scripting', 'storage', 'offscreen', 'userScripts', 'activeTab', 'nativeMessaging', 'alarms'];
    const targetPermissions = browser === 'firefox'
      ? permissions.filter((p) => p !== 'offscreen')
      : permissions;

    const baseManifest: Record<string, unknown> = {
      name: isRuntime ? 'dogear runtime' : 'dogear',
      version: '0.1.0',
      description: isRuntime
        ? 'Notebook-style step runner runtime execution engine'
        : 'Notebook-style step runner browser extension',
      permissions: targetPermissions,
      host_permissions: ['<all_urls>'],
    };

    if (isRuntime) {
      return baseManifest;
    }

    return {
      ...baseManifest,
      action: {
        default_title: 'dogear: Run Next Step',
      },
      commands: {
        'run-step': {
          suggested_key: {
            default: 'Ctrl+Shift+E',
            mac: 'Command+Shift+E',
          },
          description: 'Run current notebook step on active page',
        },
        '_execute_action': {
          suggested_key: {
            default: 'Alt+Shift+N',
          },
          description: 'Trigger dogear action',
        },
      },
    };
  },
});


