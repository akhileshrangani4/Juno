import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { useStrokeGesture } from '@/gestures/GestureSurface';
import { authorName, formatAge } from '@/narration/buildNarration';
import type { Post, PostMedia } from '@/social/types';
import { colors, type } from '@/theme';

function mediaLine(media: PostMedia): string {
  switch (media.kind) {
    case 'images': {
      const missing = media.images.filter((image) => !image.alt).length;
      const count = media.images.length === 1 ? '1 image' : `${media.images.length} images`;
      return missing ? `${count} · ${missing === media.images.length ? 'no description yet' : `${missing} without description`}` : `${count} · described`;
    }
    case 'video':
      return media.alt ? 'Video · described' : 'Video · no description yet';
    case 'link':
      return `Link · ${media.title || media.url}`;
    case 'quote':
      return `Quote · ${media.authorName}`;
  }
}

export function PostCard({ post, position }: { post: Post; position: string }) {
  const stroke = useStrokeGesture();
  const image = post.media.flatMap((media) => (media.kind === 'images' ? media.images : []))[0];
  return (
    <View style={styles.card}>
      {post.repostedBy ? <Text style={styles.meta} maxFontSizeMultiplier={type.maxScale}>Reposted by {post.repostedBy}</Text> : null}
      <Text style={styles.author} numberOfLines={2} maxFontSizeMultiplier={type.maxScale}>
        {authorName(post)}
      </Text>
      <Text style={styles.meta} numberOfLines={1} maxFontSizeMultiplier={type.maxScale}>
        @{post.author.handle} · {formatAge(post.createdAt, new Date())}
      </Text>
      <ScrollView key={post.uri} simultaneousWith={stroke} style={styles.scroll} contentContainerStyle={styles.scrollContent} indicatorStyle="white" persistentScrollbar>
        {post.text ? (
          <Text style={styles.body} maxFontSizeMultiplier={type.maxScale}>
            {post.text}
          </Text>
        ) : null}
        {image?.url ? <Image source={{ uri: image.url }} style={styles.image} contentFit="cover" accessible={false} /> : null}
        {post.media.map((media, i) => (
          <Text key={i} style={styles.media} maxFontSizeMultiplier={type.maxScale}>
            {mediaLine(media)}
          </Text>
        ))}
      </ScrollView>
      <Text style={styles.position} maxFontSizeMultiplier={type.maxScale}>
        {position}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderWidth: 6,
    borderColor: colors.focus,
    borderRadius: 24,
    backgroundColor: colors.surface,
    padding: 20,
    gap: 10,
    overflow: 'hidden',
  },
  author: { color: colors.focus, fontSize: type.title, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: type.label, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { gap: 10, paddingBottom: 4 },
  body: { color: colors.text, fontSize: type.body, lineHeight: type.bodyLineHeight, fontWeight: '600' },
  image: { height: 220, borderRadius: 12, borderWidth: 2, borderColor: colors.muted },
  media: { color: colors.text, fontSize: type.label, fontWeight: '700' },
  position: { color: colors.muted, fontSize: type.label, fontWeight: '700', marginTop: 'auto', textAlign: 'right' },
});
