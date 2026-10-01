import { Dispatch, SetStateAction, useMemo, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors, radius } from '@/lib/theme';
import { Stroke, strokeToPath } from '@/lib/signature';

interface Props {
  strokes: Stroke[];
  /** React state setter (functional updates keep the responder free of refs). */
  onChange: Dispatch<SetStateAction<Stroke[]>>;
  onSize(width: number, height: number): void;
  placeholder?: string;
}

/**
 * Handwriting pad: PanResponder collects points, react-native-svg renders
 * every stroke as a smooth Path.
 */
export function SignaturePad({
  strokes,
  onChange,
  onSize,
  placeholder = 'Распишитесь здесь',
}: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 });

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          const { locationX, locationY } = event.nativeEvent;
          onChange((prev) => [...prev, [{ x: locationX, y: locationY }]]);
        },
        onPanResponderMove: (event) => {
          const { locationX, locationY } = event.nativeEvent;
          onChange((prev) => {
            if (prev.length === 0) return prev;
            const last = prev[prev.length - 1];
            return [...prev.slice(0, -1), [...last, { x: locationX, y: locationY }]];
          });
        },
      }),
    [onChange],
  );

  return (
    <View
      style={styles.pad}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize({ w: width, h: height });
        onSize(width, height);
      }}
      {...responder.panHandlers}>
      {strokes.length === 0 ? (
        <Text style={styles.placeholder} pointerEvents="none">
          {placeholder}
        </Text>
      ) : null}
      {size.w > 0 && size.h > 0 ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg width={size.w} height={size.h}>
            {strokes.map((stroke, index) => (
              <Path
                key={index}
                d={strokeToPath(stroke)}
                stroke={colors.text}
                strokeWidth={2.6}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </Svg>
        </View>
      ) : null}
      <View style={styles.signLine} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  pad: {
    height: 210,
    backgroundColor: colors.panel2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  placeholder: {
    position: 'absolute',
    alignSelf: 'center',
    top: 92,
    color: colors.muted,
    fontSize: 14,
  },
  signLine: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 44,
    height: 1,
    backgroundColor: colors.border,
  },
});
