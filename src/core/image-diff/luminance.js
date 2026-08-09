export function luminanceAt(data, index) {
  return data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
}

export const isInk = (data, index, threshold) => luminanceAt(data, index) < threshold;
