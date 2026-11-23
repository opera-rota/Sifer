export interface MotionConfig {
  identityUrl: string;
  gatewayUrl: string;
}

const defaultIdentityUrl = 'http://127.0.0.1:8081';
const defaultGatewayUrl = 'http://127.0.0.1:8080';

export function readConfig(environment: NodeJS.ProcessEnv = process.env): MotionConfig {
  return {
    identityUrl: httpUrl('SIFER_IDENTITY_URL', environment, defaultIdentityUrl),
    gatewayUrl: httpUrl('SIFER_GATEWAY_URL', environment, defaultGatewayUrl),
  };
}

function httpUrl(name: string, environment: NodeJS.ProcessEnv, fallback: string): string {
  const value = environment[name];
  const candidate = value?.trim() ? value.trim() : fallback;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`${name} ${candidate} is not a URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${name} ${candidate} must be http or https`);
  }
  return parsed.origin;
}
