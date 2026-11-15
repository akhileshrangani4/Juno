// Tool schemas sent to Vapi with the assistant. None has a server URL, so Vapi sends every call to the
// phone as a tool-calls message and the app runs it there (src/agent/toolHandlers.ts).

import { MAX_RATE, MIN_RATE, RATE_STEP } from './settings';

type Schema = { type: 'object'; properties: Record<string, unknown>; required?: string[] };

const none: Schema = { type: 'object', properties: {} };

// answersReadBack: the tool acts on the draft just read back (or is undo), so the model may call it before the user
// has answered; any other tool called then, with no words from the user, is refused (toolHandlers.ts).
const definitions: { name: string; description: string; parameters: Schema; answersReadBack?: true }[] = [
  {
    name: 'read_post',
    description:
      'Read the post in focus aloud. The app speaks it itself. Use for "read that again", "what does it say", "read the hashtags", "describe the picture", "translate this", "read the original".',
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['full', 'brief', 'exact', 'hashtags', 'picture', 'translation'],
          description:
            'full: everything; brief: author and first line; exact: the exact words, in the original language ("read the original"); hashtags: all hashtags; picture: detailed picture and video descriptions; translation: the post translated into the user\'s language.',
        },
      },
      required: ['mode'],
    },
  },
  {
    name: 'go_to_post',
    description: 'Move focus to the next or previous post. The app reads the new post aloud.',
    parameters: { type: 'object', properties: { direction: { type: 'string', enum: ['next', 'previous'] } }, required: ['direction'] },
  },
  { name: 'like_post', description: 'Like the post in focus. No confirmation needed.', parameters: none },
  { name: 'unlike_post', description: 'Remove a like from the post in focus.', parameters: none },
  {
    name: 'draft_post',
    description: "Prepare a new post in the user's own words. The app reads it back and asks for a yes. Nothing is published.",
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: "The user's exact words, with only punctuation and capitalization fixed." } },
      required: ['text'],
    },
  },
  {
    name: 'draft_reply',
    description: "Prepare a reply to the post in focus in the user's own words. The app reads it back and asks for a yes. Nothing is published.",
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: "The user's exact words, with only punctuation and capitalization fixed." } },
      required: ['text'],
    },
  },
  { name: 'draft_repost', description: 'Prepare a repost of the post in focus. The app reads it back and asks for a yes.', parameters: none },
  {
    name: 'draft_delete_my_last_post',
    description: "Find the user's most recent post or reply and prepare to delete it. The app reads it back and asks for a yes.",
    parameters: none,
  },
  {
    name: 'edit_draft',
    description: 'Change part of the current draft: "change X to Y". The app reads the new draft back.',
    parameters: {
      type: 'object',
      properties: { find: { type: 'string', description: 'The words to replace, as in the draft.' }, replace: { type: 'string', description: "The user's new words." } },
      required: ['find', 'replace'],
    },
    answersReadBack: true,
  },
  { name: 'split_draft', description: 'Split a draft that is too long into a thread of posts. Only when the user chooses to split.', parameters: none, answersReadBack: true },
  { name: 'discard_draft', description: 'Throw away the current draft, for "cancel" or "start over".', parameters: none, answersReadBack: true },
  {
    name: 'publish_draft',
    description: 'Publish a draft the app read back, only when the reply right after the read-back was a plain yes. The app waits five seconds so they can say undo.',
    parameters: { type: 'object', properties: { draftId: { type: 'string', description: 'The draft id from the draft result.' } }, required: ['draftId'] },
    answersReadBack: true,
  },
  { name: 'undo', description: "Undo the user's most recent action: stop a post still in its five seconds or remove one being sent, throw away a draft, or reverse a like, unlike or repost. It never deletes a post or reply that already went out: for those the app reads back what would be deleted and asks for a yes, so never say anything was deleted unless the result says so.", parameters: none, answersReadBack: true },
  {
    name: 'change_narration',
    description: 'Change how the app reads posts, now and while scrolling. Pass only what changes.',
    parameters: {
      type: 'object',
      properties: {
        speed: { type: 'number', description: `Speech speed from ${MIN_RATE} to ${MAX_RATE} in steps of ${RATE_STEP}, where 1 is normal.` },
        speedChange: { type: 'string', enum: ['faster', 'slower'] },
        mode: { type: 'string', enum: ['full', 'brief'], description: 'How posts are read while scrolling.' },
        skipHashtags: { type: 'boolean' },
        pictureDetail: { type: 'string', enum: ['short', 'long'] },
        translation: {
          type: 'string',
          enum: ['on', 'off', 'device'],
          description: 'off: "stop translating"; on: "start translating again"; device: translate into the phone\'s language and read the phone\'s other languages as written.',
        },
        translateInto: { type: 'string', description: 'A language name, for "translate everything into English": every other language is translated into it.' },
        dontTranslate: { type: 'string', description: 'A language name, for "don\'t translate Spanish": posts in it are read as written.' },
        translateAgain: { type: 'string', description: 'A language name, for "translate Spanish again" after it was set not to be translated.' },
      },
    },
  },
  {
    name: 'set_listening_mode',
    description:
      'Change how the agent listens, when the user asks: "use push to talk" (they hold the screen while they talk) or "go hands-free" (always listening). The app explains the mode itself.',
    parameters: { type: 'object', properties: { mode: { type: 'string', enum: ['push_to_talk', 'hands_free'] } }, required: ['mode'] },
  },
  { name: 'read_comments', description: 'Read the replies to the post in focus aloud, in thread order. The app speaks them itself. Use for "read the comments", "what did people reply".', parameters: none },
  {
    name: 'summarize_comments',
    description: 'Get the replies to the post in focus so you can say in one or two sentences what people are saying. Use for "what are people saying", "how are people reacting".',
    parameters: none,
  },
  { name: 'gesture_help', description: 'Repeat how the gestures work. The app speaks it itself.', parameters: none },
  {
    name: 'remember',
    description: 'Remember a lasting preference or fact the user stated about themselves, like "call me Sam". Never other people\'s posts, passwords or codes.',
    parameters: { type: 'object', properties: { fact: { type: 'string', description: 'One short sentence, in the third person, e.g. "Call the user Sam."' } }, required: ['fact'] },
  },
  { name: 'recall_memories', description: 'List everything remembered about the user.', parameters: none },
  {
    name: 'forget_memory',
    description: 'Forget memories the user asks to forget.',
    parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, description: 'Memory ids from the list.' } }, required: ['ids'] },
  },
  {
    name: 'ask_to_keep_saved_memories',
    description: 'When the user asks to keep or move what they saved on this phone before signing in to their account. The app asks them the question.',
    parameters: none,
  },
  {
    name: 'answer_memory_offer',
    description: "Only in their reply right after the question about keeping what they saved before signing in: keep true if they said yes, keep false if they said no.",
    parameters: { type: 'object', properties: { keep: { type: 'boolean', description: 'true only for a plain yes.' } }, required: ['keep'] },
  },
  { name: 'open_sign_in', description: 'End the conversation and open the sign-in screen. Only after the user agrees.', parameters: none },
  { name: 'end_conversation', description: 'End the conversation and go back to scrolling, when the user says goodbye, stop, or that they are done.', parameters: none },
];

export type ToolName =
  | 'read_post'
  | 'go_to_post'
  | 'like_post'
  | 'unlike_post'
  | 'draft_post'
  | 'draft_reply'
  | 'draft_repost'
  | 'draft_delete_my_last_post'
  | 'edit_draft'
  | 'split_draft'
  | 'discard_draft'
  | 'publish_draft'
  | 'undo'
  | 'change_narration'
  | 'set_listening_mode'
  | 'read_comments'
  | 'summarize_comments'
  | 'gesture_help'
  | 'remember'
  | 'recall_memories'
  | 'forget_memory'
  | 'ask_to_keep_saved_memories'
  | 'answer_memory_offer'
  | 'open_sign_in'
  | 'end_conversation';

export const toolNames = definitions.map((definition) => definition.name as ToolName);

export const answersReadBack = new Set(definitions.filter((definition) => definition.answersReadBack).map((definition) => definition.name));

// A client-side tool can't hand a result back to the model, so after every call Vapi asks the model to respond on
// its own, and it talks over the app (around a read-back that voids the user's yes, or claiming a post went out).
// An empty request-complete message is spoken instead of that response, and an empty request-start replaces Vapi's
// "one moment" filler, so after a tool call the agent says only what the app says (its say()) and answers only when
// the app's result asks it to (add-message with triggerResponseEnabled).
const SILENT = [
  { type: 'request-start' as const, content: '' },
  { type: 'request-complete' as const, content: '' },
];

export const vapiTools = definitions.map(({ name, description, parameters }) => ({
  type: 'function' as const,
  async: true,
  function: { name, description, parameters },
  messages: SILENT,
}));
