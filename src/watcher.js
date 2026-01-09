// src/watcher.js
// Suwayomi → GraphQL subscription → Telegram (realtime)

import { existsSync, readFileSync, writeFileSync } from "fs";
import { createClient } from "graphql-ws";
import WebSocket from "ws";
import TelegramBot from "node-telegram-bot-api";
import pino from "pino";
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

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "TELEGRAM_TOKEN";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "TELEGRAM_CHAT_ID";

const STATE_FILE = process.env.STATE_FILE || "./state/state.json";

const LOG_LEVEL = process.env.LOG_LEVEL || "info";

// Getting rid of the Telegram Deprecation https://github.com/yagop/node-telegram-bot-api/issues/778
process.env.NTBA_FIX_350 = true

// ============ LOGGER ============

const usePretty =
	["debug", "trace"].includes(LOG_LEVEL);

const logger = pino({
	level: LOG_LEVEL,
	transport: usePretty
		? {
			target: "pino-pretty",
			options: {
				colorize: true,
				translateTime: "HH:MM:ss.l",
				ignore: "pid,hostname",
			},
		}
		: undefined,
});

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

// --- state utilities ---

function loadState() {
	try {
		if (existsSync(STATE_FILE)) {
			const raw = readFileSync(STATE_FILE, "utf8");
			state = JSON.parse(raw);
			if (!state.lastSeen) state.lastSeen = {};
			logger.info({ file: STATE_FILE }, "State loaded successfully");
		} else {
			logger.info({ file: STATE_FILE }, "State file not found, starting with empty state");
			state = { lastSeen: {} };
		}
	} catch (e) {
		logger.warn(
			{ error: e.message, file: STATE_FILE },
			"State load failed, initializing fresh state"
		);
		state = { lastSeen: {} };
	}
}

function saveState() {
	try {
		writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
		logger.debug({ file: STATE_FILE }, "State saved");
	} catch (e) {
		logger.error(
			{ error: e.message, file: STATE_FILE },
			"State write failed"
		);
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
		logger.info("Access token expired, re-authenticating...");
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

function isWsUnauthorizedError(err) {
	if (!err) return false;

	if (Array.isArray(err)) {
		return err.some((e) =>
			String(e.message || "").includes("Unauthorized")
		);
	}

	const msg = typeof err === "string"
		? err
		: JSON.stringify(err);

	return msg.includes("Unauthorized");
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
	logger.info("Authenticating with Suwayomi...");
	const data = await graphqlHttp(LOGIN_MUTATION, {
		input: {
			username: SUWAYOMI_USERNAME,
			password: SUWAYOMI_PASSWORD,
		},
	});
	accessToken = data.login.accessToken;
	logger.info("Authentication succeeded, access token issued");
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
			logger.warn(
				{ status: res.status, url: thumbnailPath },
				"Thumbnail request failed"
			);
			return null;
		}

		const arrayBuffer = await res.arrayBuffer();
		logger.debug({ url: thumbnailPath }, "Thumbnail fetched successfully");
		return Buffer.from(arrayBuffer);
	} catch (e) {
		logger.error(
			{ error: e.message, url: thumbnailPath },
			"Thumbnail fetch failure"
		);
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
		manga.source
			? `Source ${escape(manga.source.name)} \\(${escape(manga.source.lang)}\\)`
			: null,
		`Uploaded ${escape(uploadDate)}`,
	]
		.filter(Boolean)
		.join("\n");

	const caption = lines;

	try {
		let thumbnailBuffer = null;

		if (manga.thumbnailUrl) {
			thumbnailBuffer = await fetchThumbnailBuffer(
				`${SUWAYOMI_HTTP}${manga.thumbnailUrl}`
			);
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

		logger.info(
			{
				manga: manga.title,
				chapter: chap.chapterNumber,
				name: chap.name,
				status,
			},
			"Telegram notification sent"
		);
	} catch (e) {
		logger.error(
			{
				error: e.message,
				manga: manga.title,
				chapter: chap.chapterNumber,
				status,
			},
			"Telegram delivery failure"
		);
	}
}

// --- update handling ---

async function handleUpdates(mangaUpdates, notifyNew = true) {
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

		// First time: just register as baseline, don't notify
		if (prev === undefined) {
			lastSeen[mangaId] = chapId;
			changed = true;
			continue;
		}

		// No change
		if (prev === chapId) continue;

		// New chapter
		lastSeen[mangaId] = chapId;
		changed = true;

		if (notifyNew) {
			logger.info(
				{
					manga: manga.title,
					chapter: chap.chapterNumber,
					name: chap.name,
					status: item.status,
				},
				"New chapter detected"
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
		logger.info({ url: SUWAYOMI_WS }, "Connecting to Suwayomi WebSocket");

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

						logger.debug(
							{ updates: mangaUpdates?.length || 0 },
							"WebSocket update event"
						);

						if (!mangaUpdates || mangaUpdates.length === 0) return;

						try {
							const queue = await handleUpdates(mangaUpdates, true);
							for (const { manga, chap, status } of queue) {
								await sendTelegram(manga, chap, status);
							}
						} catch (e) {
							logger.error(
								{ error: e.message },
								"Update handling or Telegram dispatch failure"
							);
						}
					},
					error: async (err) => {
						if (isWsUnauthorizedError(err)) {
							logger.warn(
								{ error: err },
								"Unauthorized WebSocket event, attempting re-authentication"
							);
							try {
								await login();
								logger.info("Access token refreshed successfully");
							} catch (e) {
								logger.error(
									{ error: e.message },
									"Re-authentication failed after Unauthorized WebSocket event"
								);
							}
						} else {
							logger.error({ error: err }, "Unhandled WebSocket error");
						}

						finished = true;
						resolve();
					},
					complete: () => {
						logger.info("WebSocket subscription closed");
						finished = true;
						resolve();
					},
				}
			);
		});

		if (finished) {
			logger.info("Reconnecting in 5 seconds...");
			await new Promise((r) => setTimeout(r, 5000));

			try {
				await login();
			} catch (e) {
				logger.error(
					{ error: e.message },
					"Re-authentication failed during reconnect"
				);
			}
		}
	}
}

start().catch((e) => {
	logger.fatal({ error: e }, "Fatal application error");
	process.exit(1);
});