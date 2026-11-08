import { expect, test } from 'bun:test';
import { redact } from '../src/core/safety';

const leaks = {
  'database URL': 'url = "postgresql://admin:hunter2pass@db.internal/prod"',
  'mysql URL in TOML': 'dsn = mysql://root:hunter2pass@localhost/app',
  'CLI argument': '"args": ["--api-key", "abcdef1234567890abcd"]',
  'CLI flag inside an escaped JSON string':
    '"command": "server --token \\"abcdef1234567890abcd\\""',
  'CLI flag with equals': 'command = "server --token=abcdef1234567890abcd"',
  'prefixed key name': 'SUPABASE_SERVICE_ROLE_KEY: "hunter2-not-a-variable"',
  'prefixed secret key': '"STRIPE_SECRET_KEY": "hunter2-not-a-variable"',
  'Stripe live key': 'value: sk_live_0123456789abcdefghijkl',
  'Google API key': 'key: AIzaSyA0123456789abcdefghijklmnopqrstuv',
  'AWS secret in TOML': 'aws_secret_access_key = wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY',
  'unquoted DB password': 'DB_PASSWORD=hunter2pass',
  JWT: 'auth: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
};

for (const [name, text] of Object.entries(leaks))
  test(`redact catches a ${name}`, () => {
    expect(redact(text)).not.toBe(text);
    expect(redact(text)).toContain('${KITFOLD_SECRET}');
  });

test('redact leaves variable references and ordinary text alone', () => {
  for (const text of [
    'SUPABASE_SERVICE_ROLE_KEY: "${SUPABASE_SERVICE_ROLE_KEY}"',
    '"args": ["--api-key", "${API_KEY}"]',
    'url = "postgresql://localhost/prod"',
    'Use the primary key column for joins.',
    'See https://example.com/docs for details.',
  ])
    expect(redact(text)).toBe(text);
});

test('redact leaves package variables, shell variables and prose about flags alone', () => {
  for (const text of [
    'echo $npm_package_version and npm_config_cache=/tmp/cache',
    'gh api --token "$GH_TOKEN" and --token $GH_TOKEN',
    'Set --token flag to choose the account.',
    'Options: --token, --verbose',
    'export GITHUB_TOKEN=$(gh auth token)',
    'authorization: "Bearer ${API_KEY}"',
  ])
    expect(redact(text)).toBe(text);
});

test('redact stays linear on long single-line input', () => {
  const inputs = [
    'a_'.repeat(64 * 1024),
    'ab-cd-'.repeat(32 * 1024),
    `${'x'.repeat(200 * 1024)}://`,
    Buffer.alloc(192 * 1024, 7).toString('base64url'),
  ];
  for (const input of inputs) {
    const started = performance.now();
    redact(input);
    expect(performance.now() - started).toBeLessThan(500);
  }
});
