import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { firmar, firmaValida } from '../src/firma.js';

const SECRETO = 'app_secret_de_prueba';
const CUERPO = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });

describe('firma X-Hub-Signature-256', () => {
  it('acepta la firma que corresponde al cuerpo', () => {
    expect(firmaValida(CUERPO, firmar(CUERPO, SECRETO), SECRETO)).toBe(true);
  });

  it('acepta el cuerpo como Buffer (que es como llega de express.raw)', () => {
    const buf = Buffer.from(CUERPO, 'utf8');
    expect(firmaValida(buf, firmar(buf, SECRETO), SECRETO)).toBe(true);
  });

  it('rechaza si el cuerpo cambió aunque sea un byte', () => {
    const firmaOriginal = firmar(CUERPO, SECRETO);
    expect(firmaValida(CUERPO + ' ', firmaOriginal, SECRETO)).toBe(false);
  });

  it('rechaza una firma hecha con otro secreto', () => {
    expect(firmaValida(CUERPO, firmar(CUERPO, 'otro_secreto'), SECRETO)).toBe(false);
  });

  it('rechaza cuando no hay header', () => {
    expect(firmaValida(CUERPO, undefined, SECRETO)).toBe(false);
    expect(firmaValida(CUERPO, '', SECRETO)).toBe(false);
  });

  it('rechaza sin el prefijo sha256=', () => {
    const hex = crypto.createHmac('sha256', SECRETO).update(CUERPO).digest('hex');
    expect(firmaValida(CUERPO, hex, SECRETO)).toBe(false);
    expect(firmaValida(CUERPO, `sha1=${hex}`, SECRETO)).toBe(false);
  });

  it('no explota con una firma de largo distinto (timingSafeEqual tira si no miden igual)', () => {
    expect(() => firmaValida(CUERPO, 'sha256=abc', SECRETO)).not.toThrow();
    expect(firmaValida(CUERPO, 'sha256=abc', SECRETO)).toBe(false);
  });

  it('rechaza si no hay secreto configurado', () => {
    expect(firmaValida(CUERPO, firmar(CUERPO, ''), '')).toBe(false);
  });

  it('la firma es la que Meta espera: sha256= + HMAC hex del raw body', () => {
    const esperada = 'sha256=' + crypto.createHmac('sha256', SECRETO).update(CUERPO).digest('hex');
    expect(firmar(CUERPO, SECRETO)).toBe(esperada);
  });
});
