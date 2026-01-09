// src/watcher.js
// Suwayomi → GraphQL subscription → Telegram (realtime)

import { existsSync, readFileSync, writeFileSync } from "fs";
import { createClient } from "graphql-ws";
import WebSocket from "ws";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";

// Carica .env solo se presente
dotenv.config();

// ============ CONFIG ============

const SUWAYOMI_HTTP =
	process.env.SUWAYOMI_HTTP || "http://suwayomi:4567";

const SUWAYOMI_WS =
	process.env.SUWAYOMI_WS || "ws://suwayomi:4567/api/graphql";

const SUWAYOMI_USERNAME = process.env.SUWAYOMI_USERNAME || "USERNAME";
const SUWAYOMI_PASSWORD = process.env.SUWAYOMI_PASSWORD || "PASSWORD";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "BOT_TOKEN";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "CHAT_ID";

const STATE_FILE = process.env.STATE_FILE || "./state/state.json";

// Getting rid of the Telegram Deprecation https://github.com/yagop/node-telegram-bot-api/issues/778
process.env.NTBA_FIX_350 = true

// ================================

let accessToken = null;

class MyWebSocket extends WebSocket {
	constructor(address, protocols) {
		const headers = accessToken
			? { Authorization: `Bearer ${accessToken}` }
			: {};
		super(address, protocols, { headers });
	}
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

let state = { lastSeen: {} };

// --- utilities stato ---
function loadState() {
	try {
		if (existsSync(STATE_FILE)) {
			const raw = readFileSync(STATE_FILE, "utf8");
			state = JSON.parse(raw);
			if (!state.lastSeen) state.lastSeen = {};
		}
	} catch (e) {
		console.warn("Impossibile leggere stato, riparto da zero:", e.message);
		state = { lastSeen: {} };
	}
}

function saveState() {
	try {
		writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
	} catch (e) {
		console.error("Impossibile scrivere lo stato:", e.message);
	}
}

// --- GraphQL helper ---

async function graphqlHttp(query, variables = {}) {
	const res = await fetch(`${SUWAYOMI_HTTP}/api/graphql`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
		},
		body: JSON.stringify({ query, variables }),
	});

	if (res.status === 401) {
		console.log("Token scaduto, rifaccio login...");
		await login();
		return graphqlHttp(query, variables);
	}

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`HTTP ${res.status}: ${text}`);
	}

	const data = await res.json();
	if (data.errors) {
		throw new Error(JSON.stringify(data.errors));
	}
	return data.data;
}

// --- login ---

const LOGIN_MUTATION = `
mutation Login($input: LoginInput!) {
  login(input: $input) {
    accessToken
  }
}
`;

async function login() {
	console.log("Login a Suwayomi...");
	const data = await graphqlHttp(LOGIN_MUTATION, {
		input: {
			username: SUWAYOMI_USERNAME,
			password: SUWAYOMI_PASSWORD,
		},
	});
	accessToken = data.login.accessToken;
	console.log("Login OK, token ottenuto.");
}

// --- Telegram ---

function escape(str = "") {
	return String(str).replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

async function fetchThumbnailBuffer(thumbnailPath) {
	if (!thumbnailPath) return null;

	try {
		const res = await fetch(thumbnailPath, {
			headers: accessToken
				? { Authorization: `Bearer ${accessToken}` }
				: {},
		});

		if (!res.ok) {
			console.warn(`Impossibile scaricare thumbnail: HTTP ${res.status}`);
			return null;
		}

		const arrayBuffer = await res.arrayBuffer();
		return Buffer.from(arrayBuffer);
	} catch (e) {
		console.error("Errore nel fetch della thumbnail:", e.message);
		return null;
	}
}

async function sendTelegram(manga, chap, status) {
	const uploadMs = parseInt(chap.uploadDate || "0", 10);
	const uploadDate = Number.isNaN(uploadMs)
		? chap.uploadDate
		: new Date(uploadMs).toISOString().slice(0, 16).replace("T", " ");

	const lines = [
		`📚 New Chapter Available`,
		` `,
		`*${escape(manga.title)}*`,
		chap.name ? `_${escape(chap.name)}_` : null,
		`Ch\\. ${escape(chap.chapterNumber)}`,
		manga.source ? `Soruce ${escape(manga.source.name)} \\(${escape(manga.source.lang)}\\)` : null,
		`Uploaded ${escape(uploadDate)}`,
	].filter(Boolean).join("\n");

	const caption = lines;

	try {
		let thumbnailBuffer = null;

		if (manga.thumbnailUrl) {
			thumbnailBuffer = await fetchThumbnailBuffer(`${SUWAYOMI_HTTP}${manga.thumbnailUrl}`);
		}

		if (thumbnailBuffer) {
			const fileOptions = {
				filename: "thumbnail",
				contentType: "image/jpeg",
			};

			await bot.sendPhoto(TELEGRAM_CHAT_ID,
				thumbnailBuffer,
				{
					caption,
					parse_mode: "MarkdownV2",
				},
				fileOptions);
		} else {
			await bot.sendMessage(TELEGRAM_CHAT_ID, caption, {
				parse_mode: "MarkdownV2",
				disable_web_page_preview: true,
			});
		}
	} catch (e) {
		console.error("Telegram send error:", e.message);
	}
}

// --- gestione aggiornamenti ---

async function handleUpdates(mangaUpdates, notifyNew = true) {
	// ToDo Rimuoere loadstate
	loadState()
	const lastSeen = state.lastSeen || {};
	let changed = false;

	const notificationsQueue = [];

	for (const item of mangaUpdates) {
		const manga = item.manga;
		const chap = manga.latestFetchedChapter;

		if (!chap) continue;

		const mangaId = String(manga.id);
		const chapId = String(chap.chapterNumber);

		const prev = lastSeen[mangaId];

		// Prima volta: solo registro, non notifico (baseline)
		if (prev === undefined) {
			lastSeen[mangaId] = chapId;
			changed = true;
			continue;
		}

		// Nessun cambiamento
		if (prev === chapId) continue;

		// Capitolo nuovo
		lastSeen[mangaId] = chapId;
		changed = true;

		if (notifyNew) {
			console.log(
				`Nuovo capitolo per ${manga.title}: #${chap.chapterNumber} ${chap.name}`
			);

			notificationsQueue.push({
				manga,
				chap,
				status: item.status,
			});
		}
	}

	if (changed) {
		state.lastSeen = lastSeen;
		saveState();
	}

	return notificationsQueue;
}

// --- subscription WS ---

const SUBSCRIPTION_QUERY = `
subscription Updates {
  libraryUpdateStatusChanged(input: {}) {
    mangaUpdates {
      status
      manga {
        id
        title
		thumbnailUrl
		source {
		  name
		  lang
		}
        latestFetchedChapter {
          id
          chapterNumber
          name
          uploadDate
        }
      }
    }
  }
}
`;

async function start() {
	loadState();
	await login();

	while (true) {
		console.log("Apro WebSocket verso Suwayomi:", SUWAYOMI_WS);

		const client = createClient({
			url: SUWAYOMI_WS,
			webSocketImpl: MyWebSocket,
		});

		let finished = false;

		await new Promise((resolve) => {
			client.subscribe(
				{ query: SUBSCRIPTION_QUERY },
				{
					next: async (msg) => {
						const payload = msg?.data?.libraryUpdateStatusChanged;
						if (!payload) return;

						const { mangaUpdates } = payload;

						console.log(
							"EVENTO WS:",
							JSON.stringify(
								{
									mangaUpdatesCount: mangaUpdates?.length || 0,
								},
								null,
								2
							)
						);

						if (!mangaUpdates || mangaUpdates.length === 0) return;

						try {
							const queue = await handleUpdates(mangaUpdates, true);
							for (const { manga, chap, status } of queue) {
								await sendTelegram(manga, chap, status);
							}
						} catch (e) {
							console.error("Errore durante handleUpdates / invio notifiche:", e.message);
						}
					},
					error: (err) => {
						console.error("Errore WS:", err);
						finished = true;
						resolve();
					},
					complete: () => {
						console.log("Subscription completata/chiusa.");
						finished = true;
						resolve();
					},
				}
			);
		});

		if (finished) {
			console.log("Mi riconnetto tra 5 secondi...");
			await new Promise((r) => setTimeout(r, 5000));

			try {
				await login();
			} catch (e) {
				console.error("Errore nel rilogin:", e.message);
			}
		}
	}
}

start().catch((e) => {
	console.error("Errore fatale:", e);
	process.exit(1);
});
