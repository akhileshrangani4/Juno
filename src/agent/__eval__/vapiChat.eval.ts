/// <reference types="node" />
import { writeFileSync } from 'node:fs';
import https from 'node:https';

import { setup } from '@/testing/agent';

import { buildAssistant, FIRST_MESSAGE } from '../assistant';
import { describeAccount, describeFocus, describeMemories, describeSettings } from '../postContext';
import type { ToolOutcome } from '../toolHandlers';

// Runs the real assistant configuration without a microphone and plays the phone's part: every tool call goes
// to the real tool handlers against a mocked SocialProvider, and each result goes back as the message the phone
// sends during a call. It runs on a developer's machine with keys from their own shell; nothing here is deployed
// or bundled into the app.
//
//   VAPI_PRIVATE_KEY=... pnpm eval:agent                     # Vapi chat API (needs a card on the Vapi account)
//   OPENAI_API_KEY=... EVAL_BACKEND=openai pnpm eval:agent   # stand-in: same prompt and tools on the same model
//
// The transcript is written to EVAL_TRANSCRIPT (default agent-eval-transcript.md).

type ToolCall = { id: string; function: { name: string; arguments: string } };
type Message = { role: string; content?: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };

// The agent answers to the app's name and gives it when asked: the two utterances after the first check that.
// The brief's utterances, with the accepting confirmations spread across them, then the refusing ones: a hedge
// right after a read-back, a yes two turns after it, a yes with a change attached, a verb that doesn't fit the
// draft, a question of the agent's own between the read-back and the yes, and a yes split in two by speech
// recognition, whose second half arrives during the five seconds.
type Step = string | { say: string; thenDuringCountdown: true } | { agentAsks: string };

const SCRIPT: Step[] = [
  'read that again',
  'Juno, read that again',
  "what's your name?",
  'next',
  'like this',
  'repost this',
  'do it',
  "reply, that's beautiful, where was this?",
  'yes please',
  'post, hello from my new app',
  'yeah post it',
  'undo',
  'always skip the hashtags',
  'what can I do?',
  'post, good morning everyone',
  'okay let me think',
  'yes',
  'go ahead',
  'reply, see you soon',
  'sure, but change it to goodbye',
  'yes',
  'post, lunch was great',
  'yes, delete it',
  'yes',
  'post, see you all tomorrow',
  { agentAsks: 'Want me to like the post in focus too?' },
  'yes',
  'post it',
  'post, heading out now',
  { say: 'Yes.', thenDuringCountdown: true },
  'but change it to goodbye',
  'yes',
];

// node:https rather than fetch, which the React Native test environment replaces.
function post<T>(url: string, key: string | undefined, body: object): Promise<T> {
  if (!key) throw new Error(`Set the API key for ${url} in your shell`);
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, (response) => {
      let text = '';
      response.on('data', (chunk: Buffer) => (text += chunk.toString()));
      response.on('end', () => {
        if ((response.statusCode ?? 500) >= 300) reject(new Error(`${url} failed with ${response.statusCode}: ${text.slice(0, 500)}`));
        else resolve(JSON.parse(text) as T);
      });
    });
    request.on('error', reject);
    request.end(JSON.stringify(body));
  });
}

it('drives the assistant through the scripted utterances', async () => {
  const backend = process.env.EVAL_BACKEND === 'openai' ? 'openai' : 'vapi';
  const world = setup();
  const assistant = buildAssistant({
    account: describeAccount(world.deps.account()),
    settings: describeSettings(world.settings.get()),
    memories: describeMemories([]),
    focus: describeFocus(world.focus()),
  });
  const history: Message[] = [...assistant.model.messages, { role: 'assistant', content: FIRST_MESSAGE }];
  const tools = assistant.model.tools.map(({ type, function: definition }) => ({ type, function: definition }));
  let previousChatId: string | undefined;

  // One model turn: returns the new assistant messages.
  const turn = async (input: Message[]): Promise<Message[]> => {
    if (backend === 'openai') {
      history.push(...input);
      const response = await post<{ choices: { message: Message }[] }>('https://api.openai.com/v1/chat/completions', process.env.OPENAI_API_KEY, {
        model: assistant.model.model,
        temperature: assistant.model.temperature,
        messages: history,
        tools,
      });
      const message = response.choices[0].message;
      history.push(message);
      return [message];
    }
    const response = await post<{ id: string; output: Message[] }>(
      'https://api.vapi.ai/chat',
      process.env.VAPI_PRIVATE_KEY,
      previousChatId ? { previousChatId, input } : { assistant, input },
    );
    previousChatId = response.id;
    return response.output;
  };

  const log: string[] = ['| # | Speaker | What happened |', '| --- | --- | --- |'];
  let row = 0;
  const add = (who: string, what: string) => log.push(`| ${++row} | ${who} | ${what.replace(/\|/g, '\\|').replace(/\n/g, '<br>')} |`);
  const calls: { utterance: string; tools: string[]; reply: string }[] = [];

  // Messages the phone would have sent to the model by now, delivered with the next user turn.
  let carry: Message[] = [];
  let countingDown = false;
  for (const step of SCRIPT.slice(0, Number(process.env.EVAL_LIMIT) || SCRIPT.length)) {
    if (typeof step === 'object' && 'agentAsks' in step) {
      add('Agent (its own question, injected)', step.agentAsks);
      world.handlers.assistantSaid();
      carry.push({ role: 'assistant', content: step.agentAsks });
      calls.push({ utterance: `(agent asks) ${step.agentAsks}`, tools: [], reply: '' });
      continue;
    }
    const utterance = typeof step === 'string' ? step : step.say;
    const holdCountdown = typeof step === 'object';
    world.say(utterance);
    add('User', utterance);
    const used: string[] = [];
    const said: string[] = [];
    let input: Message[] = [...carry, { role: 'user', content: utterance }];
    carry = [];
    if (countingDown) {
      const heard = world.handlers.heard(utterance);
      if (heard) {
        add('App says (agent voice)', heard.speak);
        add('App tells agent', heard.message);
        input.push({ role: 'system', content: heard.message });
      }
    }
    for (let hop = 0; hop < 6 && input.length; hop++) {
      const next: Message[] = [];
      let respond = false;
      for (const message of await turn(input)) {
        if (message.content) {
          add('Agent', message.content);
          said.push(message.content);
          world.handlers.assistantSaid();
        }
        for (const call of message.tool_calls ?? []) {
          used.push(call.function.name);
          add('Tool call', `\`${call.function.name}(${call.function.arguments || ''})\``);
          const outcome: ToolOutcome = await world.handlers.run(call.function.name, JSON.parse(call.function.arguments || '{}'));
          if (outcome.speak) add('App says (agent voice)', outcome.speak);
          add('Result to agent', outcome.result);
          if (outcome.after === 'countdown') {
            world.handlers.publisher.startCountdown();
            if (!holdCountdown) await world.scheduler.advance(5000);
          }
          respond ||= outcome.respond;
          const content = `Result of ${call.function.name}: ${outcome.result}`;
          next.push(backend === 'openai' ? { role: 'tool', tool_call_id: call.id, content } : { role: 'system', content });
        }
      }
      const notices = world.notify.mock.calls.splice(0).map(([text]) => text as string);
      for (const notice of notices) add('App tells agent', notice);
      next.push(...notices.map((content) => ({ role: 'system', content })));
      if (backend === 'openai' && next.length && !respond && !notices.length) {
        history.push(...next);
        break;
      }
      input = respond || notices.length ? next : [];
      if (backend === 'vapi' && !respond && !notices.length) break;
    }
    calls.push({ utterance, tools: used, reply: said.join(' ') });
    if (countingDown) {
      await world.scheduler.advance(10_000);
      const late = world.notify.mock.calls.splice(0).map(([text]) => text as string);
      for (const notice of late) add('App tells agent', notice);
      carry.push(...late.map((content) => ({ role: 'system', content })));
    }
    countingDown = holdCountdown && world.handlers.publisher.pendingDraft !== null;
  }

  const summary = calls.map(({ utterance, tools: used, reply }) => `| ${utterance} | ${used.join(', ') || '(none)'} | ${reply.replace(/\|/g, '\\|').replace(/\n+/g, '<br>')} |`).join('\n');
  writeFileSync(
    process.env.EVAL_TRANSCRIPT ?? 'agent-eval-transcript.md',
    `Backend: ${backend === 'openai' ? `${assistant.model.model} via OpenAI (stand-in for Vapi chat)` : 'Vapi chat API'}\n\n## Tool calls per utterance\n\n| Utterance | Tools called | Agent said |\n| --- | --- | --- |\n${summary}\n\n## Full transcript\n\n${log.join('\n')}\n`,
  );
  console.log(summary);
  const reply = (utterance: string) => calls.find((call) => call.utterance === utterance);
  if (reply('Juno, read that again')) expect(reply('Juno, read that again')!.tools).toEqual(['read_post']);
  if (reply("what's your name?")) expect(reply("what's your name?")!.reply).toMatch(/Juno/);
});
