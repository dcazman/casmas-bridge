'use strict';
const express = require('express');
const router  = express.Router();
const { getApiKey, chatContext, privateContext } = require('../lib/db');
const { validate: ptValidate } = require('../lib/private');
const { logUsage } = require('../lib/usage');

const MODEL_HAIKU = 'claude-haiku-4-5-20251001';
const MODEL_OPUS  = 'claude-opus-4-7';
const OLLAMA_URL  = process.env.OLLAMA_URL || 'http://192.168.50.50:11434';
const USE_OLLAMA  = process.env.USE_OLLAMA === 'true';

const SYS_PROMPT = "You are Anchor, Dan Casmas's personal AI assistant. Be short and direct. Answer based on the notes provided.";

router.post('/', async (req, res) => {
  const { question, model, clientTime } = req.body;
  if (!question) return res.json({ answer: 'No question.' });

  const ptToken  = req.headers['x-pt-token'];
  const ptSession = ptToken ? ptValidate(ptToken) : null;
  let notes = chatContext(question);
  if (ptSession && ptSession.aiEnabled) {
    const pt = privateContext();
    if (pt) notes += '\n\nPRIVATE THOUGHTS (shared by user):\n' + pt;
  }
  const forceCloud = model === 'claude';

  try {
    if (USE_OLLAMA && !forceCloud) {
      const prompt = SYS_PROMPT + '\n\nCurrent time: ' + (clientTime || new Date().toLocaleString()) + '\n\nNOTES:\n' + notes + '\n\nQ: ' + question;
      const resp = await fetch(OLLAMA_URL + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'mistral', stream: false, messages: [{ role: 'user', content: prompt }] })
      });
      const data = await resp.json();
      res.json({ answer: data.message?.content || 'No response.', engine: 'rooster' });
    } else {
      const key = getApiKey();
      const m = forceCloud ? MODEL_OPUS : MODEL_HAIKU;
      const prompt = SYS_PROMPT + '\n\nTime: ' + (clientTime || new Date().toLocaleString()) + '\n\nNOTES:\n' + notes + '\n\nQ: ' + question;
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: m, max_tokens: 1000, messages: [{ role: 'user', content: prompt }] })
      });
      const data = await resp.json();
      if (data.usage) logUsage(data.usage.input_tokens, data.usage.output_tokens, m, 'chat');
      res.json({ answer: data.content[0].text, engine: forceCloud ? 'claude' : 'anthropic' });
    }
  } catch (e) { res.json({ answer: 'Error: ' + e.message }); }
});

module.exports = router;
