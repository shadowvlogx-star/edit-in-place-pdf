import { useState } from "react";
import { UploadScreen } from "@/components/UploadScreen";
import { EditorView } from "@/components/EditorView";

const Index = () => {
  const [file, setFile] = useState<File | null>(null);
  return file ? (
    <EditorView file={file} onBack={() => setFile(null)} />
  ) : (
    <UploadScreen onFile={setFile} />
  );
};

export default Index;
