// アクセス制御はサーバ側セッション（auth-status Function + HttpOnly Cookie）＋各ページの誘導で実施しています。
// Edge によるゲートは現在使用していません。ビルドを通すための無害な no-op です。
export default async () => {};
