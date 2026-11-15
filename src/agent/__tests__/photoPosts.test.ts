import type { CameraTools } from '@/agent/toolHandlers';
import { setup } from '@/testing/agent';

import { UNDO_WINDOW_MS } from '../publisher';

const draftIdOf = (result: string) => result.match(/draftId="([^"]+)"/)?.[1] ?? '';

function withPhoto(alt = 'A red mug with a white handle on a wooden desk.') {
  const env = setup();
  let photo: ReturnType<CameraTools['photo']> = { uri: 'file:///upload.jpg', mimeType: 'image/jpeg', alt };
  const camera: jest.Mocked<CameraTools> = {
    run: jest.fn<string, Parameters<CameraTools['run']>>(() => 'DONE: The app is doing it on the phone and tells the user. Say nothing.'),
    photo: jest.fn(() => photo),
    photoUsed: jest.fn(() => void (photo = null)),
  };
  env.deps.camera = camera;
  env.provider.uploadImage.mockImplementation(async (_image, altText) => ({ alt: altText, handle: { blob: 'mug' } }));
  return { ...env, camera };
}

async function publish(env: ReturnType<typeof withPhoto>, draftResult: string) {
  env.say('Yes.');
  const confirmed = await env.handlers.run('publish_draft', { draftId: draftIdOf(draftResult) });
  expect(confirmed.after).toBe('countdown');
  env.handlers.publisher.startCountdown();
  await env.scheduler.advance(UNDO_WINDOW_MS);
}

describe('posting a photo from the camera or the library', () => {
  it('attaches the kept photo to the next new post and reads its description back with the draft', async () => {
    const env = withPhoto();
    env.say('Post my morning coffee.');
    const draft = await env.handlers.run('draft_post', { text: 'My morning coffee.' });
    expect(draft.speak).toBe('Posting to your followers: My morning coffee. With the image description: A red mug with a white handle on a wooden desk. Shall I post it?');
  });

  it('posts a photo with no words', async () => {
    const env = withPhoto();
    env.say('Just post the picture.');
    const draft = await env.handlers.run('draft_post', { text: '' });
    expect(draft.speak).toBe('Posting a photo with no text to your followers. With the image description: A red mug with a white handle on a wooden desk. Shall I post it?');
    await publish(env, draft.result);
    expect(env.provider.createPost).toHaveBeenCalledWith({ text: '', images: [{ alt: 'A red mug with a white handle on a wooden desk.', handle: { blob: 'mug' } }] });
  });

  it('uploads the photo with its alt text, publishes it with the words after the yes and five seconds, and uses it up', async () => {
    const env = withPhoto();
    env.say('Post my morning coffee.');
    const draft = await env.handlers.run('draft_post', { text: 'My morning coffee.' });
    expect(env.provider.uploadImage).not.toHaveBeenCalled();
    await publish(env, draft.result);
    expect(env.provider.uploadImage).toHaveBeenCalledWith({ uri: 'file:///upload.jpg', mimeType: 'image/jpeg' }, 'A red mug with a white handle on a wooden desk.');
    expect(env.provider.createPost).toHaveBeenCalledWith({ text: 'My morning coffee.', images: [{ alt: 'A red mug with a white handle on a wooden desk.', handle: { blob: 'mug' } }] });
    expect(env.camera.photoUsed).toHaveBeenCalled();
  });

  it('changes the image description by voice, in the user\'s own words, and reads the draft back again', async () => {
    const env = withPhoto();
    env.say('Post my morning coffee.');
    const first = await env.handlers.run('draft_post', { text: 'My morning coffee.' });
    env.say('Change the description to my favourite blue mug on my desk.');
    const whole = await env.handlers.run('edit_image_description', { text: 'My favourite blue mug on my desk.' });
    expect(whole.speak).toBe('Posting to your followers: My morning coffee. With the image description: My favourite blue mug on my desk. Shall I post it?');
    expect(draftIdOf(whole.result)).not.toBe(draftIdOf(first.result));
    env.say('In the description change blue to green.');
    const part = await env.handlers.run('edit_image_description', { find: 'blue', replace: 'green' });
    expect(part.speak).toContain('With the image description: My favourite green mug on my desk.');
    env.say('Yes.');
    expect((await env.handlers.run('publish_draft', { draftId: draftIdOf(first.result) })).refused).toBe('staleDraft');
    env.say('Change the description to something lovely.');
    expect((await env.handlers.run('edit_image_description', { text: 'A beautiful artistic photograph.' })).result).toMatch(/^REWORDED/);
  });

  it('reads back that there is no description when none could be written, and lets the user give one', async () => {
    const env = withPhoto('');
    env.say('Post it.');
    const draft = await env.handlers.run('draft_post', { text: '' });
    expect(draft.speak).toBe('Posting a photo with no text to your followers. The image has no description yet. You can tell me what it should say. Shall I post it?');
  });

  it('never attaches the photo to a reply, and throws it away with a discarded draft', async () => {
    const env = withPhoto();
    env.say('Reply lovely.');
    const reply = await env.handlers.run('draft_reply', { text: 'Lovely.' });
    expect(reply.speak).not.toContain('image description');
    env.say('Post my coffee.');
    await env.handlers.run('draft_post', { text: 'My coffee.' });
    const discarded = await env.handlers.run('discard_draft', {});
    expect(discarded.result).toContain('and the photo with it');
    expect(env.camera.photoUsed).toHaveBeenCalled();
  });

  it('still needs a draft with words or a photo', async () => {
    const env = setup();
    env.say('Post.');
    expect((await env.handlers.run('draft_post', { text: '' })).result).toMatch(/^EMPTY/);
    expect((await env.handlers.run('edit_image_description', { text: 'x' })).result).toMatch(/^REWORDED|^NO_IMAGE/);
  });

  it('runs camera actions on the phone and tells the model to stay quiet', async () => {
    const env = withPhoto();
    const outcome = await env.handlers.run('camera', { action: 'check', subject: ' my dog ' });
    expect(env.camera.run).toHaveBeenCalledWith('check', 'my dog');
    expect(outcome).toMatchObject({ respond: false, result: expect.stringMatching(/^DONE/) });
  });
});
