import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { CAVEAT_FONT, colors } from '@/lib/theme';
import { dataUrlToSvg, signatureTextFromDataUrl, svgPathDataList, svgSize } from '@/lib/signature';

interface Props {
  /** data:image/... подпись (нарисованная или SVG с текстом). */
  dataUrl?: string | null;
  /** Вид подписи: 'text'/'typed' — текст; 'png'/'drawn' — картинка. */
  kind?: string | null;
  /** Текст печатной подписи, если сервер его вернул. */
  text?: string | null;
  /** Высота превью в px. */
  height?: number;
}

function isTextKind(kind: string | null | undefined): boolean {
  return kind === 'text' || kind === 'typed';
}

/**
 * Превью подписи в договорах и профиле (SPEC §17):
 * текст — строкой шрифтом Caveat; изображение — <img>/SVG paths.
 */
export function SignaturePreview({ dataUrl, kind, text, height = 84 }: Props) {
  const resolvedText =
    text?.trim() ||
    (isTextKind(kind) ? (signatureTextFromDataUrl(dataUrl) ?? null) : null);

  if (resolvedText) {
    return (
      <View style={[styles.box, { minHeight: height }]}>
        <Text style={[styles.text, { fontSize: Math.min(34, height * 0.42) }]} numberOfLines={2}>
          {resolvedText}
        </Text>
      </View>
    );
  }

  if (dataUrl?.startsWith('data:image/png')) {
    return (
      <View style={[styles.box, { minHeight: height }]}>
        <Image source={{ uri: dataUrl }} style={{ height, width: '100%' }} resizeMode="contain" />
      </View>
    );
  }

  const svg = dataUrlToSvg(dataUrl);
  if (svg) {
    const paths = svgPathDataList(svg);
    if (paths.length > 0) {
      const size = svgSize(svg);
      const width = Math.round((height * size.width) / Math.max(1, size.height));
      return (
        <View style={[styles.box, { minHeight: height }]}>
          <Svg width={width} height={height} viewBox={`0 0 ${size.width} ${size.height}`}>
            <Rect x={0} y={0} width={size.width} height={size.height} fill={colors.bg} />
            {paths.map((d, index) => (
              <Path
                key={index}
                d={d}
                stroke={colors.text}
                strokeWidth={2.5}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </Svg>
        </View>
      );
    }
    // SVG без paths (например, текстовая подпись) — пробуем достать текст
    const inner = signatureTextFromDataUrl(dataUrl);
    if (inner) {
      return (
        <View style={[styles.box, { minHeight: height }]}>
          <Text style={[styles.text, { fontSize: Math.min(34, height * 0.42) }]} numberOfLines={2}>
            {inner}
          </Text>
        </View>
      );
    }
  }

  return (
    <View style={[styles.box, { minHeight: height }]}>
      <Text style={styles.muted}>Подпись недоступна</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  text: {
    color: colors.accent,
    fontFamily: CAVEAT_FONT,
    textAlign: 'center',
  },
  muted: {
    color: colors.muted,
    fontSize: 13,
  },
});
