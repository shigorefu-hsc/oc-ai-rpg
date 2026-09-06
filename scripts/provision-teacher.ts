import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  AdminCreateUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
const deployment = JSON.parse(await readFile('.local/deployment.json', 'utf8'));
const client = new CognitoIdentityProviderClient({ region: deployment.region });
const username = process.env.TEACHER_USERNAME ?? 'teacher';
try {
  await client.send(
    new AdminGetUserCommand({ UserPoolId: deployment.UserPoolId, Username: username }),
  );
  console.log('Teacher already exists; password was not changed.');
  process.exit(0);
} catch (e) {
  if ((e as Error).name !== 'UserNotFoundException') throw e;
}
const temporary = randomBytes(18).toString('base64url') + 'aA1!';
await client.send(
  new AdminCreateUserCommand({
    UserPoolId: deployment.UserPoolId,
    Username: username,
    TemporaryPassword: temporary,
    MessageAction: 'SUPPRESS',
  }),
);
const directory = resolve(process.env.OUTPUT_DIR ?? '.local');
await mkdir(directory, { recursive: true });
const text = [
  '# Доступ учителя',
  '',
  'Сайт: ' + deployment.URL,
  '',
  'Логин: ' + username,
  '',
  'Временный пароль: ' + temporary,
  '',
  'При первом входе приложение попросит задать свой пароль (от 12 символов: строчные и прописные буквы, цифры и знак). Временный пароль действует 7 дней.',
  '',
  'В настройках приложения можно выбрать Nova Lite или Haiku 4.5. Модель можно также поменять для отдельной работы.',
  '',
  'Создайте работу → откройте её → «生徒に渡す · 60分». Вы выйдете из кабинета учителя; ученик получит только эту работу на один час. Для другого компьютера используйте одноразовый пригласительный линк.',
  '',
  'Файл содержит пароль: храните его приватно и удалите после смены пароля.',
  '',
].join('\n');
await writeFile(resolve(directory, 'teacher-access.md'), text, { mode: 0o600 });
console.log(
  'Created teacher. Initial password saved privately to ' +
    resolve(directory, 'teacher-access.md') +
    '; no email sent.',
);
