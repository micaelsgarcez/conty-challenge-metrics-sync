# Exemplos de request e response

Execução real com `npm start` em 2026-10-11, banco novo com o seed, nesta ordem. Os `id` e os horários mudam a cada execução. O provedor da demo é o falso de `src/fake-provider.ts`. O token de cada conexão do seed escolhe o cenário: `tok_ok` responde normal, `tok_429` dá um 429 com `Retry-After: 2` e depois responde, `tok_429_longo` pede 120 s, `tok_503` falha sempre. Cada post do provedor tem dois snapshots, capturados em 2026-10-01T12:00Z e 2026-10-03T12:00Z.

## Primeira janela

```
curl -s -X POST http://127.0.0.1:3004/connections/con_ana_instagram/sync -H 'content-type: application/json' -d '{"from":"2026-10-01T00:00:00Z","to":"2026-10-02T00:00:00Z"}'
```

Resposta:

```
{"id":"run_31d1110c-0d76-4ccd-b931-0685ccb06bcf","connection_id":"con_ana_instagram","window_from":"2026-10-01T00:00:00.000Z","window_to":"2026-10-02T00:00:00.000Z","started_at":"2026-10-11T08:18:44.647Z","finished_at":"2026-10-11T08:18:44.663Z","status":"succeeded","attempts":1,"error_code":null,"last_error":null}
HTTP 201
```

## Janela que se sobrepõe à anterior

A janela vai até 04/10 e reencontra os snapshots de 01/10. Eles não viram número novo.

```
curl -s -X POST http://127.0.0.1:3004/connections/con_ana_instagram/sync -H 'content-type: application/json' -d '{"from":"2026-10-01T00:00:00Z","to":"2026-10-04T00:00:00Z"}'
```

Resposta:

```
{"id":"run_230e7d37-9f1e-489b-949a-2491301c020d","connection_id":"con_ana_instagram","window_from":"2026-10-01T00:00:00.000Z","window_to":"2026-10-04T00:00:00.000Z","started_at":"2026-10-11T08:18:44.678Z","finished_at":"2026-10-11T08:18:44.696Z","status":"succeeded","attempts":1,"error_code":null,"last_error":null}
HTTP 201
```

## Posts com a data de captura e a de busca

Cada post tem 2 snapshots, não 4. O total é o mais recente (`captured_at` de 03/10), não a soma. `fetched_at` é quando o serviço buscou.

```
curl -s http://127.0.0.1:3004/connections/con_ana_instagram/posts
```

Resposta:

```
{"posts":[{"external_post_id":"instagram_post_1","views":2000,"likes":20,"comments":0,"shares":0,"captured_at":"2026-10-03T12:00:00.000Z","fetched_at":"2026-10-11T08:18:44.686Z","snapshots":2},{"external_post_id":"instagram_post_2","views":4000,"likes":20,"comments":0,"shares":0,"captured_at":"2026-10-03T12:00:00.000Z","fetched_at":"2026-10-11T08:18:44.686Z","snapshots":2}]}
HTTP 200
```

## Total do criador

```
curl -s http://127.0.0.1:3004/creators/crt_ana/totals
```

Resposta:

```
{"creator_id":"crt_ana","posts":2,"views":6000,"likes":40,"comments":0,"shares":0,"last_fetched_at":"2026-10-11T08:18:44.686Z"}
HTTP 200
```

## Provedor responde 429 com Retry-After

O serviço espera 2 s. `started_at` e `finished_at` diferem por 2,017 s e `attempts` é 2.

```
curl -s -X POST http://127.0.0.1:3004/connections/con_ana_tiktok/sync -H 'content-type: application/json' -d '{"from":"2026-10-01T00:00:00Z","to":"2026-10-04T00:00:00Z"}'
```

Resposta:

```
{"id":"run_e7440b2f-2f3d-41d8-b3e2-a5ad2bc2834d","connection_id":"con_ana_tiktok","window_from":"2026-10-01T00:00:00.000Z","window_to":"2026-10-04T00:00:00.000Z","started_at":"2026-10-11T08:18:44.723Z","finished_at":"2026-10-11T08:18:46.740Z","status":"succeeded","attempts":2,"error_code":null,"last_error":null}
HTTP 201
```

## Retry-After acima do teto

O provedor pede 120 s e o teto é 60 s. Não espera e não tenta de novo.

```
curl -s -X POST http://127.0.0.1:3004/connections/con_ana_youtube/sync -H 'content-type: application/json' -d '{"from":"2026-10-01T00:00:00Z","to":"2026-10-04T00:00:00Z"}'
```

Resposta:

```
{"id":"run_d0e7f834-5c26-4967-b68a-e5ba6293dbdc","connection_id":"con_ana_youtube","window_from":"2026-10-01T00:00:00.000Z","window_to":"2026-10-04T00:00:00.000Z","started_at":"2026-10-11T08:18:46.754Z","finished_at":"2026-10-11T08:18:46.761Z","status":"failed","attempts":1,"error_code":"retry_after_exceeds_cap","last_error":"O provedor pediu 120000 ms de espera e o teto é 60000 ms."}
HTTP 201
```

## Falha transitória que não passa

Quatro tentativas, com backoff de 0,5 s, 1 s e 2 s entre elas (3,5 s no total). Depois o serviço desiste.

```
curl -s -X POST http://127.0.0.1:3004/connections/con_ana_x/sync -H 'content-type: application/json' -d '{"from":"2026-10-01T00:00:00Z","to":"2026-10-04T00:00:00Z"}'
```

Resposta:

```
{"id":"run_361c939d-829f-436c-ae6b-8f7c5c0c2f98","connection_id":"con_ana_x","window_from":"2026-10-01T00:00:00.000Z","window_to":"2026-10-04T00:00:00.000Z","started_at":"2026-10-11T08:18:46.778Z","finished_at":"2026-10-11T08:18:50.289Z","status":"failed","attempts":4,"error_code":"attempts_exhausted","last_error":"O provedor falhou 4 vezes seguidas: provedor respondeu 503."}
HTTP 201
```

## Janela invertida

```
curl -s -X POST http://127.0.0.1:3004/connections/con_ana_x/sync -H 'content-type: application/json' -d '{"from":"2026-10-04T00:00:00Z","to":"2026-10-01T00:00:00Z"}'
```

Resposta:

```
{"error":"A janela precisa ter from antes de to.","code":"window_invalid"}
HTTP 422
```

## Plataforma inválida

```
curl -s -X POST http://127.0.0.1:3004/connections -H 'content-type: application/json' -d '{"creator_id":"crt_bruno","platform":"orkut","token":"t"}'
```

Resposta:

```
{"error":"A plataforma deve ser uma de: instagram, tiktok, youtube, x.","code":"platform_invalid"}
HTTP 422
```
