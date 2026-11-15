// Tool schemas sent to Vapi with the assistant. None has a server URL, so Vapi sends every call to the
// phone as a tool-calls message and the app runs it there (src/agent/toolHandlers.ts).

import { MAX_RATE, MIN_RATE, RATE_STEP } from './settings';

type Schema = { type: 'object'; properties: Record<string, unknown>; required?: string[] };

const none: Schema = { type: 'object', properties: {} };

const definitions: { name: string; description: string; parameters: Schema }[] = [
  {
    name: 'read_post',
    description: 'Read the post in focus aloud. The app speaks it itself. Use for "read that again", "what does it say", "read the hashtags", "describe the picture".',
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['full', 'brief', 'exact', 'hashtags', 'picture'],
          description: 'full: everything; brief: author and first line; exact: the exact words; hashtags: all hashtags; picture: detailed picture and video descriptions.',
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
  },
  {
    name: 'edit_image_description',
    description:
      'Change the description of the photo in the draft, which is what other people\'s screen readers will say. Pass text for a whole new description in the user\'s words, or find and replace to change part of it. The app reads the draft back.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: "The whole new description, in the user's words." },
        find: { type: 'string', description: 'Words in the current description to replace.' },
        replace: { type: 'string', description: "The user's new words for them." },
      },
    },
  },
  { name: 'split_draft', description: 'Split a draft that is too long into a thread of posts. Only when the user chooses to split.', parameters: none },
  { name: 'discard_draft', description: 'Throw away the current draft, for "cancel" or "start over".', parameters: none },
  {
    name: 'publish_draft',
    description: 'Publish a draft the app read back, only when the reply right after the read-back was a plain yes. The app waits five seconds so they can say undo.',
    parameters: { type: 'object', properties: { draftId: { type: 'string', description: 'The draft id from the draft result.' } }, required: ['draftId'] },
  },
  { name: 'undo', description: 'Undo the last action: stop a post still in its five seconds, or remove the last like, repost, post or reply.', parameters: none },
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
      },
    },
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
  {
    name: 'camera',
    description:
      'The camera and the photo library. The app does it on the phone and speaks for itself (cues, descriptions, what was taken), so say nothing after it unless the result asks. open: "open the camera". photos: "choose from my photos". describe: "what do you see?". check: "is my dog in the picture?", "is the whole sign in view?", with subject. shutter: "take the picture". flip: "switch camera". keep and retake: the answer to "keep it or take another?". next and previous: move through the photos. choose: "this one", "pick it". descriptions_on and descriptions_off: whether pictures may be sent to be described. close: "close the camera".',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['open', 'photos', 'describe', 'check', 'shutter', 'flip', 'keep', 'retake', 'next', 'previous', 'choose', 'descriptions_on', 'descriptions_off', 'close'],
        },
        subject: { type: 'string', description: 'For check: what the user asked about, in their words, e.g. "my dog", "the whole sign".' },
      },
      required: ['action'],
    },
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
  | 'edit_image_description'
  | 'split_draft'
  | 'discard_draft'
  | 'publish_draft'
  | 'undo'
  | 'change_narration'
  | 'gesture_help'
  | 'remember'
  | 'recall_memories'
  | 'forget_memory'
  | 'ask_to_keep_saved_memories'
  | 'answer_memory_offer'
  | 'camera'
  | 'open_sign_in'
  | 'end_conversation';

export const toolNames = definitions.map((definition) => definition.name as ToolName);

export const vapiTools = definitions.map(({ name, description, parameters }) => ({
  type: 'function' as const,
  async: true,
  function: { name, description, parameters },
}));
