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
SPRING_PROFILES_ACTIVE=localdev docker compose --profile ui up
```
Adds the FederatedGateWay console, so you can configure and monitor everything from a browser instead. The console always requires a login; `localdev` gives it two throwaway accounts, `admin`/`admin` and `user`/`user`, so there is nothing to set up. **Development only**: those credentials are public. For anything else, see [Signing in](#signing-in).

| Service | URL | Started by |
|---|---|---|
| APISIX (proxy) | http://localhost:9880 | always |
| APISIX Control API | http://localhost:9882 | always |
| Prometheus | http://localhost:9090 | always |
| **Console UI** | http://localhost:8080 | `--profile ui` |
| Keycloak | http://localhost:8081 | `--profile keycloak` |

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
      - CONSOLE_AUTH_TYPE=OIDC             # or IN_MEMORY, see "Signing in" below
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

## Signing in

Every request to the console needs an authenticated user - there is no anonymous mode. How users authenticate is a single setting, `CONSOLE_AUTH_TYPE`:

| Value | How users log in | Choose it when |
|---|---|---|
| `OIDC` (default) | Redirected to an OpenID Connect provider such as Keycloak | You have an identity provider, or you want single sign-on, group mapping, or the GitHub/GitLab token brokering below |
| `IN_MEMORY` | A username and password form on the console itself | Running an identity provider is not an option |

An unset or misspelled value stops the console from starting. That is deliberate: the alternative failure mode is a gateway admin UI that quietly serves everything unauthenticated.

### OIDC

The default, so there is nothing to switch on - just supply the provider:

```
KEYCLOAK_ISSUER_URI=https://keycloak.example.com/realms/frank
KEYCLOAK_CLIENT_ID=frank-console
KEYCLOAK_CLIENT_SECRET=...
```

Add `https://<console>/login/oauth2/code/keycloak` to the client's valid redirect URIs.

The issuer is resolved on the first login rather than at startup, so a provider that is briefly unreachable costs that one login instead of stopping the console from starting. The flip side: a console that is up no longer proves the provider is reachable, so check `/api/auth/mode` and an actual login rather than the health endpoint alone.

### Local accounts

Accounts are provisioned by whoever runs the console. This mode is deliberately limited - no sign-up, no password reset, no MFA, no account management UI, and no login rate limiting or lockout. Changing a password means editing configuration and restarting. Each of those is a reason to move to OIDC rather than something to work around.

```
CONSOLE_AUTH_TYPE=IN_MEMORY
CONSOLE_SECURITY_AUTH_IN_MEMORY_USERS_0_USERNAME=admin
CONSOLE_SECURITY_AUTH_IN_MEMORY_USERS_0_PASSWORD={bcrypt}$2a$10$...
CONSOLE_SECURITY_AUTH_IN_MEMORY_USERS_0_ROLES=gateway-user,gateway-admin
```

Repeat with `_1_`, `_2_` and so on for more users. Generate a hash with `htpasswd -bnBC 10 "" yourpassword | tr -d ':\n'` and keep the `{bcrypt}` prefix. `{noop}yourpassword` works unhashed for a throwaway local run and logs a warning saying as much.

**There is no default login.** Selecting `IN_MEMORY` without configuring any users makes the console refuse to start, rather than invent an account whose password ends up in the log. For local development use the `localdev` profile instead, which ships throwaway accounts - see [Local development](#local-development).

Role names are yours to choose. Using `gateway-user` and `gateway-admin` matches the Keycloak realm in `docker-compose.yaml`, so the same names reach the UI whichever mode you run.

### In Helm

```yaml
console:
  auth:
    type: IN_MEMORY
    inMemoryUsers:
      - username: admin
        password: "{bcrypt}$2a$10$..."
        roles: [gateway-user, gateway-admin]
```

Passwords are rendered into a Secret rather than the pod spec. To keep them out of `values.yaml` entirely, create the Secret yourself with one key per username and set `console.auth.existingSecret` to its name, omitting the `password` fields. Leaving `type` at its `OIDC` default uses the `console.keycloak.*` values instead.

---

## Connecting GitHub or GitLab

> Requires `CONSOLE_AUTH_TYPE=OIDC`. With local accounts there is no identity provider to broker through, so the console falls back to personal access tokens.

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

# ...or, to develop against Keycloak as well:
docker compose --profile keycloak up
```

**2. Start the backend**, choosing how you sign in:
```bash
cd Back-End

# Local accounts - needs nothing else running. Log in as admin/admin or user/user.
./mvnw spring-boot:run -Dspring-boot.run.profiles=localdev

# ...or against Keycloak, which needs the profile from step 1.
# Same two logins: the imported realm ships admin/admin and user/user.
./mvnw spring-boot:run
```
Runs on http://localhost:8080. Keycloak's own admin console is http://localhost:8081, `admin`/`admin`.

**3. Start the frontend:**
```bash
cd front-end
npm install
npm run dev
# Runs on http://localhost:5500
```
That port is pinned deliberately: Vite's default 5173 falls inside a range Windows reserves for Hyper-V, and a port that moves would break the OIDC redirect URI.

**4.** Open http://localhost:5500 and sign in. Then go to http://localhost:5500/config and set the host to `http://127.0.0.1`, control port `9882`, metrics port `9881`.

To switch between the two login modes, restart the backend with or without `-Dspring-boot.run.profiles=localdev`. Nothing else changes, and the frontend needs no rebuild - it asks the backend which mode is active.

---

## Kubernetes / Helm

A sample Helm chart is available in the `helm/` directory. It is provided as a starting point.

```bash
helm install federated-gateway ./helm \
  --set console.keycloak.issuerUri=https://keycloak.example.com/realms/frank \
  --set console.keycloak.clientSecret=...
```

Those two are required by the chart's `OIDC` default, and it fails at template time without them rather than deploying something that cannot be logged into. To use local accounts instead, set `console.auth.type` and `console.auth.inMemoryUsers` - see [Signing in](#signing-in).

---

## TLS and FSC/NLX support

By default the gateway runs over plain HTTP. To enable HTTPS or the FSC/NLX plugin (for connecting to the Dutch government NLX network), create a `.env` file next to the compose file. See `.env.example` in the [Frank!Gateway repository](https://github.com/wearefrank/frank-gateway) for the variables and format.

- **Server certificate and key** - required for the gateway to accept HTTPS connections from clients
- **Client certificate chain** - required for mutual TLS, used by the FSC/NLX plugin to authenticate the gateway to other NLX parties
- **Self-signed CA** - used to trust certificates from internal or custom upstream services
