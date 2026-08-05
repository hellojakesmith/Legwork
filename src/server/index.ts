import { app } from "./app.js";

const port = Number(process.env.PORT ?? 8787);

app.listen(port, () => {
  console.log(`Legwork server listening on http://127.0.0.1:${port}`);
});
