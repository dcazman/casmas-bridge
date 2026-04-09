'use strict';
const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const { getApiKey, chatContext } = require('../lib/db');
const { logUsage } = require('../lib/usage');

const MODEL_HAIKU = 'claude-haiku-4-5-20251001';
const MODEL_OPUS  = 'claude-opus-4-5';
const OLLAMA_URL  = process.env.OLLAMA_URL || 'http://192.168.50.50:11434';
const USE_OLLAMA  = process.env.USE_OLLAMA === 'true';
const OLLAMA_PROMPT_PATH = '/bridge/md/ollama-system-prompt.md';

function loadOllamaPrompt() {
  try { return fs.readFileSync(OLLAMA_PROMPT_PATH, 'utf8').trim(); }
  catch { return "You are Anchor, Dan's personal AI assistant. Be short and direct."; }
}

router.post('/', async (req, res) => {
  const { question, model, clientTime } = req.body;
  if (!question) return res.json({ answer: 'No question.' });

  const notes  = chatContext(question);
  const forceCloud = model === 'claude';

  try {
    if (USE_OLLAMA && !forceCloud) {
      const sysPrompt = loadOllamaPrompt();
      const fullPrompt = sysPrompt + '\n\nCurrent time: ' + (clientTime||new Date().toLocaleString()) + '\n\nNOTES:\n' + notes + '\n\nQ: ' + question;
      const resp = await fetch(OLLAMA_URL + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama3.2:3b', stream: false, messages: [{ role: 'user', content: fullPrompt }] })
      });
      const data = await resp.json();
      res.json({ answer: data.message?.content || 'No response.', engine: 'ollama' });
    } else {
      const key = getApiKey();
      const m = forceCloud ? MODEL_OPUS : MODEL_HAIKU;
      const sysPromptCloud = loadOllamaPrompt();
      const prompt = sysPromptCloud + '\n\nTime: ' + (clientTime||new Date().toLocaleString()) + '\n\nNOTES:\n' + notes + '\n\nQ: ' + question;
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: m, max_tokens: 1000, messages: [{ role: 'user', content: prompt }] })
      });
      const data = await resp.json();
      if (data.usage) logUsage(data.usage.input_tokens, data.usage.output_tokens, m, 'chat');
      res.json({ answer: data.content[0].text, engine: forceCloud ? 'claude' : 'anthropic' });
    }
  } catch(e) { res.json({ answer: 'Error.' }); }
});

module.exports = router;
