# ai-taiken.shigorefu.com: DNS в お名前.com

Выбран CNAME без постоянного IP и без отдельного сервера. DNS-зона остаётся у владельца в お名前.com.

## 1. Подтвердить HTTPS-сертификат

В зоне shigorefu.com добавьте:

| Поле                                 | Значение                                                          |
| ------------------------------------ | ----------------------------------------------------------------- |
| Тип                                  | CNAME                                                             |
| Имя / Host                           | \_889c8ebd75951982c272dddced48b1fa.ai-taiken                      |
| Полное имя, если панель требует FQDN | \_889c8ebd75951982c272dddced48b1fa.ai-taiken.shigorefu.com        |
| Значение / Value                     | \_66f34b09a99c72e2337922cb5cd4946f.jkddzztszm.acm-validations.aws |
| TTL                                  | 300 или значение по умолчанию                                     |

Имя указано в двух формах: используйте одну в зависимости от поля панели, не добавляйте shigorefu.com дважды. Это запись проверки сертификата, не адрес сайта. Её нужно оставить для автоматического продления.

ACM certificate: arn:aws:acm:ap-northeast-1:997868087180:certificate/20f5a5db-ac15-47f5-a4e5-b8b50aa12a0d.
На момент подготовки статус PENDING_VALIDATION.

## 2. Создать привязку и получить CNAME сайта

После появления первой записи в публичном DNS:

    AWS_PROFILE=default npx tsx scripts/configure-domain.ts

Команда проверяет сертификат. Пока он не подтверждён, возвращает запись проверки и ничего не меняет в работающем приложении. После ISSUED создаёт региональный custom domain и привязку к этапу demo. Результат — .local/domain.json, поле siteRecord.Value.

В お名前.com затем добавляется вторая запись:

| Поле       | Значение                                      |
| ---------- | --------------------------------------------- |
| Тип        | CNAME                                         |
| Имя / Host | ai-taiken                                     |
| Value      | Точное siteRecord.Value из результата команды |
| TTL        | 300 или значение по умолчанию                 |

Это будет региональный hostname API Gateway. Не подставляйте IP, URL с https://, путь /demo/ или исходный Lambda URL. Не публикуйте предполагаемое значение до создания привязки: оно выдаётся AWS.

После распространения DNS откройте https://ai-taiken.shigorefu.com/ . Учётная запись преподавателя та же, но cookie разных доменов независимы — потребуется войти на новом домене.

## Рабочие адреса до готовности DNS

- Lambda: https://eyqzowc7tmytmhskhpnkaxn4ze0yeodo.lambda-url.ap-northeast-1.on.aws/
- Regional API Gateway: https://rrexf055j6.execute-api.ap-northeast-1.amazonaws.com/demo/

Неподтверждённый сертификат не мешает пользоваться этими адресами.

Источники: [AWS Regional custom domains](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-regional-api-custom-domain-create.html), [AWS streaming Lambda integration](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-streaming-lambda-configure.html).
