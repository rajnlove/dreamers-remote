import { BrowserRouter, Route, Routes } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import RemotePage from "./pages/RemotePage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/remote/:id" element={<RemotePage />} />
      </Routes>
    </BrowserRouter>
  );
}
