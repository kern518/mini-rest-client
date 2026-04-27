# Mini REST Client

A tiny standalone REST Client inspired by VS Code REST Client.

## Features

- Open a local folder as a request workspace
- Manage `.http` and `.rest` files from the sidebar
- Create folders and request files directly on disk
- Edit requests with Monaco Editor
- Send requests from inline `Send Request` CodeLens actions
- Auto-save file edits to the opened workspace
- Show status, elapsed time, response headers, and formatted body

## Development

```powershell
npm install
npm run tauri -- dev
```

## Build

```powershell
npm run tauri -- build
```

## Supported `.http` Syntax

```http
@baseUrl = https://jsonplaceholder.typicode.com

### Get user
GET {{baseUrl}}/users/1
Accept: application/json

### Create post
POST {{baseUrl}}/posts
Content-Type: application/json

{
  "title": "hello"
}
```
