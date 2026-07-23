import { useEffect, useRef, useState } from "react";

// Mantém um estado (filtro, busca, ordenação...) salvo na sessão do navegador,
// para que ele NÃO volte ao padrão quando o usuário sai da página e retorna
// (ex.: clica em outro menu e volta para Cobranças). Dura enquanto a aba
// estiver aberta — fecha o navegador e reseta, como um filtro "temporário".
export function usePersistedState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.sessionStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // sessionStorage indisponível (ex. modo privado) — ignora, sem quebrar a página
    }
  }, [key, value]);

  return [value, setValue];
}

// Roda um efeito só quando as dependências MUDAM de verdade, ignorando a
// primeira renderização (montagem). Usado para não resetar a página (1) logo
// depois de restaurar um filtro salvo — só quando o usuário muda o filtro
// de fato, depois que a tela já carregou.
export function useEffectAfterMount(effect: () => void, deps: React.DependencyList) {
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    effect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
