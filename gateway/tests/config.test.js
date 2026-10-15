import { describe, it, expect } from 'vitest';
import { cargarConfig, faltantesDeConfig } from '../src/config.js';

const META = { META_APP_SECRET: 's', META_VERIFY_TOKEN: 'v', META_GRAPH_TOKEN: 'g' };

describe('credencial del modelo', () => {
  it('con ANTHROPIC_API_KEY no falta nada', () => {
    const cfg = cargarConfig({ ...META, ANTHROPIC_API_KEY: 'k' });
    expect(faltantesDeConfig(cfg)).toEqual([]);
  });

  it('con un gateway compatible (ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN) tampoco falta nada', () => {
    const cfg = cargarConfig({ ...META, ANTHROPIC_BASE_URL: 'https://openrouter.ai/api', ANTHROPIC_AUTH_TOKEN: 't' });
    expect(faltantesDeConfig(cfg)).toEqual([]);
  });

  it('un AUTH_TOKEN sin BASE_URL no alcanza: iría contra Anthropic con un token ajeno', () => {
    const cfg = cargarConfig({ ...META, ANTHROPIC_AUTH_TOKEN: 't' });
    expect(faltantesDeConfig(cfg)).toEqual(['ANTHROPIC_API_KEY o ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN']);
  });

  it('sin ninguna credencial del modelo, lo nombra', () => {
    const cfg = cargarConfig({ ...META });
    expect(faltantesDeConfig(cfg)).toEqual(['ANTHROPIC_API_KEY o ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN']);
  });
});
