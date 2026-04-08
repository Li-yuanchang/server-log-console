import CryptoJS from "crypto-js";

const FINALSHELL_RANDOM_DIVISOR = 3680984568597093857n;

export function decodeFinalShellPassword(encodedPassword: string): string | null {
  try {
    const xkDecoded = decodeXk(encodedPassword);
    if (isReadableText(xkDecoded)) {
      return xkDecoded.trim();
    }
  } catch {
    // ignore and try the fallback chain
  }

  try {
    const nestedDecoded = decodeViaGdAndNr(encodedPassword);
    if (isReadableText(nestedDecoded)) {
      return nestedDecoded.trim();
    }
  } catch {
    // ignore and return null below
  }

  return null;
}

function decodeXk(encodedPassword: string): string {
  const payload = Buffer.from(encodedPassword, "base64");
  if (payload.length <= 8) {
    throw new Error("FinalShell xk payload too short");
  }

  const header = payload.subarray(0, 8);
  const body = payload.subarray(8);
  return decryptWithDerivedKey(body, buildFinalShellDesKey(header, "xk"));
}

function decodeNr(encodedPassword: string): string {
  const payload = Buffer.from(encodedPassword, "base64");
  const prefixLength = 9;
  const headerLength = 11;
  if (payload.length <= prefixLength + headerLength) {
    throw new Error("FinalShell nr payload too short");
  }

  const header = payload.subarray(prefixLength, prefixLength + headerLength);
  const body = payload.subarray(prefixLength + headerLength);
  return decryptWithDerivedKey(body, buildFinalShellDesKey(header, "nr"));
}

function decodeGd(encodedPassword: string): string {
  const payload = Buffer.from(encodedPassword, "base64");
  const prefixLength = 17;
  const headerLength = 31;
  if (payload.length <= prefixLength + headerLength) {
    throw new Error("FinalShell gD payload too short");
  }

  const header = payload.subarray(prefixLength, prefixLength + headerLength);
  const body = payload.subarray(prefixLength + headerLength);
  return decryptWithDerivedKey(body, buildFinalShellDesKey(header, "gd"));
}

function decodeViaGdAndNr(encodedPassword: string): string {
  const firstPass = decodeGd(encodedPassword);
  if (!/^[A-Za-z0-9+/=]+$/.test(firstPass)) {
    throw new Error("FinalShell gD result is not a Base64 string");
  }
  return decodeNr(firstPass);
}

function decryptWithDerivedKey(encryptedBody: Buffer, key: Buffer): string {
  const decrypted = CryptoJS.DES.decrypt(
    {
      ciphertext: CryptoJS.enc.Hex.parse(encryptedBody.toString("hex"))
    } as never,
    CryptoJS.enc.Hex.parse(key.toString("hex")),
    {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7
    }
  );

  return decrypted.toString(CryptoJS.enc.Utf8);
}

function buildFinalShellDesKey(header: Buffer, mode: "xk" | "nr" | "gd"): Buffer {
  const signedHeader = [...header].map((value) => toSignedByte(value));
  const headerRandom = new JavaStyleRandom(BigInt(signedHeader[5] ?? 0));
  let divisor = headerRandom.nextInt(127);
  if (mode === "gd") {
    divisor = 5 + headerRandom.nextInt(107);
  } else if (mode === "nr" && divisor === 0) {
    divisor = 5 + headerRandom.nextInt(107);
  }

  if (!divisor) {
    throw new Error("Invalid FinalShell password payload");
  }

  const random = new JavaStyleRandom(FINALSHELL_RANDOM_DIVISOR / BigInt(divisor));
  for (let index = 0; index < (header[0] ?? 0); index += 1) {
    random.nextLong();
  }

  const nestedRandom = new JavaStyleRandom(random.nextLong());
  const values = [
    BigInt(signedHeader[4] ?? 0),
    nestedRandom.nextLong(),
    BigInt(signedHeader[7] ?? 0),
    BigInt(signedHeader[3] ?? 0),
    nestedRandom.nextLong(),
    BigInt(signedHeader[1] ?? 0),
    random.nextLong(),
    BigInt(signedHeader[2] ?? 0)
  ];

  const buffer = Buffer.alloc(values.length * 8);
  values.forEach((value, index) => {
    buffer.writeBigInt64BE(value, index * 8);
  });

  return Buffer.from(CryptoJS.MD5(CryptoJS.enc.Hex.parse(buffer.toString("hex"))).toString(CryptoJS.enc.Hex), "hex").subarray(0, 8);
}

class JavaStyleRandom {
  private seed: bigint;

  constructor(seed: bigint) {
    this.seed = (seed ^ 0x5deece66dn) & ((1n << 48n) - 1n);
  }

  next(bits: number): number {
    this.seed = (this.seed * 0x5deece66dn + 0xbn) & ((1n << 48n) - 1n);
    const value = Number(this.seed >> BigInt(48 - bits));
    if (bits === 32 && value >= 2 ** 31) {
      return value - 2 ** 32;
    }
    return value;
  }

  nextInt(bound: number): number {
    if ((bound & -bound) === bound) {
      return Math.floor((bound * this.next(31)) / 2 ** 31);
    }

    let bits = 0;
    let value = 0;
    do {
      bits = this.next(31);
      value = bits % bound;
    } while (bits - value + (bound - 1) < 0);
    return value;
  }

  nextLong(): bigint {
    let value = (BigInt(this.next(32)) << 32n) + BigInt(this.next(32));
    if (value >= 1n << 63n) {
      value -= 1n << 64n;
    }
    if (value < -(1n << 63n)) {
      value += 1n << 64n;
    }
    return value;
  }
}

function toSignedByte(value: number): number {
  return value > 127 ? value - 256 : value;
}

function isReadableText(value: string | null | undefined): value is string {
  if (!value || !value.trim()) {
    return false;
  }
  if (value.includes("\u0000")) {
    return false;
  }

  return /^[\p{L}\p{N}\p{P}\p{S}\p{Zs}\t\r\n]+$/u.test(value);
}
