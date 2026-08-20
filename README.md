# FederatedGateWay

A management UI for [Frank!Gateway](https://github.com/wearefrank/frank-gateway), an Apache APISIX-based API gateway built by WeareFrank. FederatedGateWay lets you configure and monitor the gateway through a browser instead of editing YAML files by hand.

## What it does

- Design and manage routes, upstreams, consumers and services via a form-based UI
- Validate APISIX config files against the live schema
- Topology in React flow build from the config your editing

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

---

## Quick Start

**Prerequisite:** [Docker Desktop](https://www.docker.com/products/docker-desktop/)

Both the gateway and the console are published as ready-to-run images, so you don't need to clone this repo just to run it — grab the compose file on its own:

```bash
curl -O https://raw.githubusercontent.com/wearefrank/frank-gateway-console/master/docker-compose.yaml
```

**Option A — Just the gateway**
```bash
docker compose up
```
Starts Frank!Gateway (APISIX) and Prometheus. Routes are configured by editing the inline YAML under `configs:` in `docker-compose.yaml`.

**Option B — Gateway + management console**
```bash
docker compose --profile ui up
```
Adds the FederatedGateWay console, so you can configure and monitor everything from a browser instead.

| Service | URL | Included in |
|---|---|---|
| APISIX (proxy) | http://localhost:9880 | A & B |
| APISIX Control API | http://localhost:9882 | A & B |
| Prometheus | http://localhost:9090 | A & B |
| **Console UI** | http://localhost:8080 | B only |

> **Note:** When routing traffic to services on your host machine, use `host.docker.internal` instead of `127.0.0.1` in your upstream nodes.

---

## Using the images in your own setup

Both images are on GHCR, so you can drop them into infrastructure you already manage instead of using this repo's compose file or Helm chart directly.

- **Gateway:** `ghcr.io/wearefrank/frank-gateway:master`
- **Console:** `ghcr.io/wearefrank/federated-gateway-console:latest`

### In your own docker-compose file

```yaml
services:
  apisix:
    image: ghcr.io/wearefrank/frank-gateway:master
    ports:
      - "9880:9080"   # HTTP proxy
      - "9882:9092"   # Control API
      - "9881:9091"   # Prometheus metrics
    volumes:
      - ./apisix.yaml:/usr/local/apisix/conf/apisix.yaml
      - ./config.yaml:/usr/local/apisix/conf/config.yaml

  console:
    image: ghcr.io/wearefrank/federated-gateway-console:latest
    ports:
      - "8080:8080"
    environment:
      - APISIX_HOST=http://apisix          # point at the apisix service above
      - PROMETHEUS_URL=http://prometheus:9090
      - KEYCLOAK_ISSUER_URI=https://keycloak.example.com/realms/frank
      - KEYCLOAK_CLIENT_ID=frank-console
      - KEYCLOAK_CLIENT_SECRET=...
      - GIT_BROKER_PROVIDERS=github,gitlab  # see "Connecting GitHub or GitLab" below
      - FORWARD_HEADERS_STRATEGY=framework  # keep when a proxy terminates TLS
    volumes:
      - console_data:/data                 # persists the console's own connection settings

volumes:
  console_data:
```

### In your own Helm chart

Reference the images as values (this is exactly what `helm/values.yaml` in this repo does):

```yaml
# values.yaml
frankgateway:
  image: ghcr.io/wearefrank/frank-gateway:master
console:
  image: ghcr.io/wearefrank/federated-gateway-console:latest
```

```yaml
# templates/console.yaml (excerpt)
containers:
  - name: console
    image: {{ .Values.console.image }}
    env:
      - name: APISIX_HOST
        value: "http://{{ .Release.Name }}-frankgateway"
      - name: PROMETHEUS_URL
        value: "http://{{ .Release.Name }}-prometheus:9090"
      - name: KEYCLOAK_ISSUER_URI
        value: {{ .Values.console.keycloak.issuerUri | quote }}
    ports:
      - containerPort: 8080
```

See `helm/templates/console.yaml` for the full working version, including the PVC used to persist `/data`.

---

## Connecting GitHub or GitLab

The version history page reads and writes your gateway config in a Git repository. By default it asks for a personal access token, which the browser then stores in `localStorage` and sends on every request.

Instead, Keycloak can broker GitHub and GitLab. Users connect their account once from the Git Settings panel, and the console reads the token from Keycloak per request - it never reaches the browser and is revoked centrally by removing the link.

**In the local compose setup**, put the OAuth app credentials in a `.env` file next to `docker-compose.yaml`:

```
GITHUB_IDP_CLIENT_ID=...
GITHUB_IDP_CLIENT_SECRET=...
GITLAB_IDP_CLIENT_ID=...
GITLAB_IDP_CLIENT_SECRET=...
```

The GitHub OAuth App's *Authorization callback URL* must be `http://localhost:8081/realms/frank/broker/github/endpoint` (`.../gitlab/endpoint` for GitLab). The realm imported by the `keycloak` profile already contains both identity providers. Because that realm is in-memory, links are lost when the container is recreated.

**Against your own Keycloak**, a realm admin has to set this up by hand:

1. Add an identity provider with alias `github` and/or `gitlab`, using the callback URL Keycloak shows you.
2. Turn on **Store tokens** and **Stored tokens readable**, and request scopes `read:user user:email repo` (GitHub) or `openid read_user api` (GitLab). Narrower scopes cannot read and write repository file contents. On GitHub also turn on **JSON Format**, otherwise Keycloak stores the token response form-urlencoded (the console reads either shape, but JSON is what Keycloak expects for refreshing).
3. Give users two client roles: `broker` → `read-token`, needed to read the stored token, and `account` → `manage-account`, which Keycloak's linking endpoint checks before it will start the flow. Most realms hand out `manage-account` through the `default-roles-<realm>` composite already; `read-token` is only granted automatically to accounts *created* by logging in through the provider, not to existing accounts that link afterwards. Without either one the link attempt just bounces back with `not_allowed`.
4. Add `https://<console>/api/git/link/callback` to the console client's valid redirect URIs.
5. Set `GIT_BROKER_PROVIDERS` on the console to the aliases you configured, or to an empty value to hide the connect buttons entirely.

Two things worth knowing before you enable this: the requested scope applies to **every** user who connects, so GitHub's `repo` grants the console read/write on all their repositories, not just the config one. And Keycloak's built-in GitLab provider only talks to gitlab.com - for a self-hosted GitLab, configure a generic OIDC provider under the alias `gitlab` instead.

Gitea is not brokered; it keeps using access tokens.

---

## Local development

**Prerequisites:** Java 25, Maven, Node.js 22+

**1. Start the gateway:**
```bash
docker compose up
```

**2. Start the backend:**
```bash
cd Back-End
./mvnw spring-boot:run
# Runs on http://localhost:8080
```

**3. Start the frontend:**
```bash
cd front-end
npm install
npm run dev
# Runs on http://localhost:5173
```

**4.** Open http://localhost:5173/config and set the host to `http://127.0.0.1`, control port `9882`, metrics port `9881`.

---

## Kubernetes / Helm

A sample Helm chart is available in the `helm/` directory. It is provided as a starting point.

```bash
helm install federated-gateway ./helm
```

---

## TLS and FSC/NLX support

By default the gateway runs over plain HTTP. To enable HTTPS or the FSC/NLX plugin (for connecting to the Dutch government NLX network), create a `.env` file next to the compose file. See `.env.example` in the [Frank!Gateway repository](https://github.com/wearefrank/frank-gateway) for the variables and format.

- **Server certificate and key** - required for the gateway to accept HTTPS connections from clients
- **Client certificate chain** - required for mutual TLS, used by the FSC/NLX plugin to authenticate the gateway to other NLX parties
- **Self-signed CA** - used to trust certificates from internal or custom upstream services
