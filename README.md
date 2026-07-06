# BankLuv

Fake USD banking apps for local demos.

## Run

```powershell
node server.js
```

Open:

- Manager app: http://localhost:3007/manager
- Checkout app: http://localhost:3007/checkout
- Customer app: http://localhost:3007/customer

The server stores shared fake-bank data in `data/bankluv-state.json`.

Default app passwords:

- Manager: `manager`
- Checkout: `checkout`

The manager app can change both passwords.

## App-only servers

For a public customer-only portal, open a second terminal and run:

```powershell
$env:APP_MODE='customer'
$env:PORT='3008'
node server.js
```

Then expose only that customer portal:

```powershell
npx localtunnel --port 3008
```

Give customers the tunnel URL. The customer-only server sends `/` and `/customer` to the portal and does not serve the manager page.

You can also run app-only servers for staff devices:

```powershell
$env:APP_MODE='manager'
$env:PORT='3009'
node server.js
```

```powershell
$env:APP_MODE='checkout'
$env:PORT='3010'
node server.js
```

Demo login:

- Username: `maya`
- Password: `bankluv`
