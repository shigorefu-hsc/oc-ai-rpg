import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { Store, put, Conflict } from './store';
export type Session = {
  kind: 'teacher' | 'demo';
  ownerId: string;
  username: string;
  workId?: string;
  expiresAt: number;
  csrf: string;
};
export const secret = () => randomBytes(32).toString('base64url');
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export const cookieName = '__Host-rpg';
export function readCookie(req: Request, local = false): string | null {
  const name = local ? 'rpg-local' : cookieName;
  return (
    req.headers
      .get('cookie')
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith(name + '='))
      ?.slice(name.length + 1) ?? null
  );
}
export function cookie(token: string, maxAge: number, local = false) {
  return (
    (local ? 'rpg-local' : cookieName) +
    '=' +
    token +
    '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' +
    maxAge +
    (local ? '' : '; Secure')
  );
}
export class AuthError extends Error {
  constructor(
    public status: number,
    public code: string,
    public message: string,
  ) {
    super(message);
  }
}
type Challenge = { username: string; cognitoSession: string; expiresAt: number };
export class Auth {
  private cognito = new CognitoIdentityProviderClient({ maxAttempts: 1 });
  private verifier;
  constructor(
    private store: Store,
    private config: { local: boolean; userPoolId: string; clientId: string },
    private now = () => Date.now(),
  ) {
    this.verifier = config.local
      ? null
      : CognitoJwtVerifier.create({
          userPoolId: config.userPoolId,
          clientId: config.clientId,
          tokenUse: 'access',
        });
  }
  async session(req: Request) {
    const token = readCookie(req, this.config.local);
    if (!token || !/^[\w-]{43}$/.test(token)) return null;
    const row = await this.store.get<Session>('auth', 'SESSION#' + hash(token));
    if (!row || row.data.expiresAt <= this.now()) return null;
    return { row, token, session: row.data };
  }
  async limitLogin(ip: string) {
    const now = this.now(),
      key = 'LOGIN#' + hash(ip) + '#' + Math.floor(now / 600000);
    for (let i = 0; i < 4; i++) {
      const row = await this.store.get<{ count: number }>('auth', key);
      if ((row?.data.count ?? 0) >= 10)
        throw new AuthError(429, 'LOGIN_LIMIT', '少し待ってからログインしてください。');
      try {
        await this.store.commit([
          put(
            'auth',
            key,
            'META',
            { count: (row?.data.count ?? 0) + 1 },
            row,
            Math.floor(now / 1000) + 1200,
          ),
        ]);
        return;
      } catch (e) {
        if (!(e instanceof Conflict)) throw e;
      }
    }
    throw new AuthError(429, 'BUSY', '少し待ってください。');
  }
  async login(
    username: string,
    password: string,
    newPassword?: string,
    challengeId?: string,
  ): Promise<{ challengeId: string } | { session: Session; token: string }> {
    const now = this.now();
    let ownerId: string;
    if (this.config.local) {
      if (username !== 'teacher' || password !== 'local-demo-only')
        throw new AuthError(401, 'LOGIN_FAILED', 'ユーザー名またはパスワードを確認してください。');
      ownerId = 'local-teacher';
    } else {
      let response;
      try {
        if (challengeId) {
          const c = await this.store.get<Challenge>('auth', 'CHALLENGE#' + hash(challengeId));
          if (!c || c.data.expiresAt <= now || c.data.username !== username || !newPassword)
            throw new Error('Invalid challenge');
          await this.store.commit([
            { table: 'auth', pk: c.pk, sk: c.sk, expected: c.revision, remove: true },
          ]);
          response = await this.cognito.send(
            new RespondToAuthChallengeCommand({
              ClientId: this.config.clientId,
              ChallengeName: 'NEW_PASSWORD_REQUIRED',
              Session: c.data.cognitoSession,
              ChallengeResponses: { USERNAME: username, NEW_PASSWORD: newPassword },
            }),
          );
        } else
          response = await this.cognito.send(
            new InitiateAuthCommand({
              ClientId: this.config.clientId,
              AuthFlow: 'USER_PASSWORD_AUTH',
              AuthParameters: { USERNAME: username, PASSWORD: password },
            }),
          );
        if (response.ChallengeName === 'NEW_PASSWORD_REQUIRED' && response.Session) {
          const id = secret();
          await this.store.commit([
            put(
              'auth',
              'CHALLENGE#' + hash(id),
              'META',
              { username, cognitoSession: response.Session, expiresAt: now + 300000 },
              null,
              Math.floor(now / 1000) + 300,
            ),
          ]);
          return { challengeId: id };
        }
        if (!response.AuthenticationResult?.AccessToken) throw new Error('No access token');
        const payload = await this.verifier!.verify(response.AuthenticationResult.AccessToken);
        ownerId = payload.sub;
      } catch {
        throw new AuthError(
          401,
          'LOGIN_FAILED',
          'ログインできませんでした。入力内容を確認して、もう一度お試しください。',
        );
      }
    }
    const token = secret(),
      session: Session = {
        kind: 'teacher',
        ownerId,
        username,
        expiresAt: now + 8 * 3600000,
        csrf: secret(),
      };
    await this.store.commit([
      put(
        'auth',
        'SESSION#' + hash(token),
        'META',
        session,
        null,
        Math.floor(session.expiresAt / 1000),
      ),
    ]);
    return { session, token };
  }
}
