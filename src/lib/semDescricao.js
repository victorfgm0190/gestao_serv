// OS lançada sem descrição (o lote marca só o dia; a descrição é completada depois,
// editando a OS). '' e NULL contam igual — o banco tem os dois.
export const semDescricao = (e) => !String(e?.description ?? '').trim()
