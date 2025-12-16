import './globals.css';

export const metadata = {
  title: 'Chatterbox TTS Streaming',
  description: 'Low-latency TTS streaming service for voicebots',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
