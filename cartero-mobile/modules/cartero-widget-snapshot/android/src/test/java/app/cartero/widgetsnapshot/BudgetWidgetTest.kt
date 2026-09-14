package app.cartero.widgetsnapshot

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/*
  ── O que este arquivo protege ──

  O widget roda no processo do LAUNCHER. Duas propriedades quebram em silêncio
  e ambas são caras:

  1. Uma exceção aqui não vira erro de app: vira widget quebrado na tela
     inicial, ou o launcher derrubando o Cartero. Por isso todo conteúdo
     inesperado — arquivo truncado, versão futura, campo faltando — precisa
     terminar num estado desenhável.

  2. Com a privacidade ligada, o valor não pode aparecer NEM na tela NEM na
     acessibilidade. Esconder visualmente e deixar o TalkBack anunciar
     inverteria a proteção justamente para quem depende dela em público.

  Robolectric porque `org.json` é um stub sem implementação no JVM puro do
  AGP — sem ele todo parse devolveria null e os testes passariam sem
  exercitar nada.
*/
@RunWith(RobolectricTestRunner::class)
class SnapshotReaderTest {

  private fun readyJson(
    version: Int = 1,
    month: Int = 9,
    hideAmounts: Boolean = true,
    toPay: String = "75724",
  ) = """
    {
      "version": $version,
      "state": "ready",
      "generatedAt": "2026-09-14T12:00:00.000Z",
      "ownerId": "user-a",
      "privacy": { "hideAmounts": $hideAmounts },
      "budget": {
        "month": $month,
        "year": 2026,
        "currency": "BRL",
        "totalToPayCents": $toPay,
        "totalPaidCents": 44624,
        "totalPendingCents": 31100
      }
    }
  """.trimIndent()

  /* ────────────── G1–G2: os estados válidos ────────────── */

  @Test
  fun `G1 - READY valido e lido`() {
    val state = SnapshotReader.parse(readyJson())

    assertTrue(state is SnapshotState.Ready)
    val ready = state as SnapshotState.Ready
    assertEquals(9, ready.month)
    assertEquals(2026, ready.year)
    assertEquals(75724L, ready.totalToPayCents)
    assertEquals(44624L, ready.totalPaidCents)
    assertEquals(31100L, ready.totalPendingCents)
    assertTrue(ready.hideAmounts)
  }

  @Test
  fun `G2 - signedOut valido e lido`() {
    val state = SnapshotReader.parse(
      """{"version":1,"state":"signedOut","generatedAt":"2026-09-14T12:00:00.000Z"}""",
    )

    assertEquals(SnapshotState.SignedOut, state)
  }

  /* ────────────── G3–G8: tudo o mais é neutro, nunca crash ────────────── */

  @Test
  fun `G3 - conteudo ausente nao quebra`() {
    assertEquals(SnapshotState.Unavailable, SnapshotReader.parse(null))
    assertEquals(SnapshotState.Unavailable, SnapshotReader.parse(""))
    assertEquals(SnapshotState.Unavailable, SnapshotReader.parse("   "))
  }

  @Test
  fun `G4 - JSON corrompido nao quebra`() {
    // O truncado é o caso real: escrita interrompida por morte do processo.
    assertEquals(
      SnapshotState.Unavailable,
      SnapshotReader.parse("""{"version":1,"state":"rea"""),
    )
    assertEquals(SnapshotState.Unavailable, SnapshotReader.parse("[]"))
    assertEquals(SnapshotState.Unavailable, SnapshotReader.parse("texto solto"))
  }

  @Test
  fun `G5 - versao desconhecida nunca e lida como V1`() {
    /*
      O widget é código INSTALADO: pode ser semanas mais velho que o app que
      escreve o arquivo. Interpretar campos de um formato que ele não conhece
      produziria números errados na tela inicial, sem erro aparecer.
    */
    assertEquals(SnapshotState.Unavailable, SnapshotReader.parse(readyJson(version = 2)))
    assertEquals(SnapshotState.Unavailable, SnapshotReader.parse(readyJson(version = 0)))
    assertEquals(
      SnapshotState.Unavailable,
      SnapshotReader.parse("""{"state":"ready","generatedAt":"x"}"""),
    )
  }

  @Test
  fun `G6 - READY incompleto e recusado`() {
    val semBudget =
      """{"version":1,"state":"ready","generatedAt":"2026-09-14T12:00:00.000Z","privacy":{"hideAmounts":true}}"""
    assertEquals(SnapshotState.Unavailable, SnapshotReader.parse(semBudget))

    val semGeneratedAt = readyJson().replace(
      """"generatedAt": "2026-09-14T12:00:00.000Z",""",
      "",
    )
    assertEquals(SnapshotState.Unavailable, SnapshotReader.parse(semGeneratedAt))

    assertEquals(SnapshotState.Unavailable, SnapshotReader.parse(readyJson(month = 13)))
    assertEquals(SnapshotState.Unavailable, SnapshotReader.parse(readyJson(month = 0)))
  }

  @Test
  fun `G7 - centavos precisam ser inteiros`() {
    /*
      Um campo fracionário ou textual NÃO pode virar zero: zero é uma
      afirmação financeira — "você não deve nada" — e inventá-la na tela
      inicial é pior que não mostrar valor nenhum.
    */
    assertEquals(SnapshotState.Unavailable, SnapshotReader.parse(readyJson(toPay = "757.24")))
    assertEquals(SnapshotState.Unavailable, SnapshotReader.parse(readyJson(toPay = "\"75724\"")))
    assertEquals(SnapshotState.Unavailable, SnapshotReader.parse(readyJson(toPay = "null")))
  }

  @Test
  fun `G8 - privacy ausente e recusada`() {
    val semPrivacy = readyJson().replace("""ateral""", "")
      .replace(""""privacy": { "hideAmounts": true },""", "")
    assertEquals(SnapshotState.Unavailable, SnapshotReader.parse(semPrivacy))
  }
}

@RunWith(RobolectricTestRunner::class)
class BudgetWidgetPresenterTest {

  private val generatedAt = 1_789_387_200_000L // 2026-09-14T12:00:00Z

  private fun ready(
    hideAmounts: Boolean = true,
    toPay: Long = 75724,
    paid: Long = 44624,
    pending: Long = 31100,
    month: Int = 9,
  ) = SnapshotState.Ready(
    month = month,
    year = 2026,
    currency = "BRL",
    totalToPayCents = toPay,
    totalPaidCents = paid,
    totalPendingCents = pending,
    hideAmounts = hideAmounts,
    generatedAtMillis = generatedAt,
  )

  /* ────────────── G9–G10: título e moeda ────────────── */

  @Test
  fun `G9 - o mes vem do snapshot, em portugues`() {
    val model = BudgetWidgetPresenter.present(ready(month = 9), generatedAt)
      as BudgetWidgetUiModel.Ready

    assertEquals("CARTERO · SETEMBRO", model.title)

    val janeiro = BudgetWidgetPresenter.present(ready(month = 1), generatedAt)
      as BudgetWidgetUiModel.Ready
    assertEquals("CARTERO · JANEIRO", janeiro.title)

    val dezembro = BudgetWidgetPresenter.present(ready(month = 12), generatedAt)
      as BudgetWidgetUiModel.Ready
    assertEquals("CARTERO · DEZEMBRO", dezembro.title)
  }

  @Test
  fun `G10 - valores visiveis usam moeda pt-BR a partir de centavos`() {
    val model = BudgetWidgetPresenter.present(ready(hideAmounts = false), generatedAt)
      as BudgetWidgetUiModel.Ready

    // NBSP é o separador que o ICU usa em pt-BR; normalizamos para comparar.
    assertEquals("R$ 446,24", model.paidValue.replace(' ', ' '))
    assertEquals("R$ 311,00", model.pendingValue.replace(' ', ' '))
  }

  @Test
  fun `moeda e exata em centavos, sem erro de ponto flutuante`() {
    /*
      `cents / 100.0` em Double reintroduziria o erro que o M2 eliminou ao
      gravar inteiros. BigDecimal desloca a vírgula exatamente.
    */
    val casos = mapOf(
      0L to "R$ 0,00",
      1L to "R$ 0,01",
      29L to "R$ 0,29",
      1999L to "R$ 19,99",
      44624L to "R$ 446,24",
      31100L to "R$ 311,00",
      123456789L to "R$ 1.234.567,89",
    )

    for ((cents, esperado) in casos) {
      assertEquals(
        esperado,
        BudgetWidgetPresenter.formatCents(cents, "BRL").replace(' ', ' '),
      )
    }
  }

  /* ────────────── G11–G12: privacidade, os dois canais ────────────── */

  @Test
  fun `G11 - com privacidade ligada nenhum valor aparece na UI`() {
    val model = BudgetWidgetPresenter.present(ready(hideAmounts = true), generatedAt)
      as BudgetWidgetUiModel.Ready

    assertEquals(BudgetWidgetPresenter.MASK, model.paidValue)
    assertEquals(BudgetWidgetPresenter.MASK, model.pendingValue)

    // Varredura no modelo inteiro: nenhum campo pode conter cifrão ou dígito
    // dos valores reais.
    val textoVisivel = listOf(
      model.title, model.paidValue, model.paidLabel,
      model.pendingValue, model.pendingLabel, model.staleText ?: "",
    ).joinToString(" ")

    assertFalse(textoVisivel.contains("R$"))
    assertFalse(textoVisivel.contains("446"))
    assertFalse(textoVisivel.contains("311"))
  }

  @Test
  fun `G12 - a privacidade tambem vale para a acessibilidade`() {
    /*
      ESTE é o vazamento silencioso: esconder na tela e deixar o leitor de tela
      anunciar. Quem usa TalkBack em público é exatamente quem mais depende da
      máscara.
    */
    val model = BudgetWidgetPresenter.present(ready(hideAmounts = true), generatedAt)
      as BudgetWidgetUiModel.Ready

    for (descricao in listOf(model.paidDescription, model.pendingDescription)) {
      assertFalse(descricao.contains("R$"))
      assertFalse(descricao.contains("446"))
      assertFalse(descricao.contains("311"))
      assertFalse(descricao.contains("44624"))
    }

    assertEquals("Valor pago oculto", model.paidDescription)
    assertEquals("Valor a pagar oculto", model.pendingDescription)
  }

  @Test
  fun `sem privacidade a acessibilidade pode anunciar os valores`() {
    val model = BudgetWidgetPresenter.present(ready(hideAmounts = false), generatedAt)
      as BudgetWidgetUiModel.Ready

    assertTrue(model.paidDescription.contains("446,24"))
    assertTrue(model.pendingDescription.contains("311,00"))
  }

  @Test
  fun `o ownerId nunca entra na apresentacao`() {
    val model = BudgetWidgetPresenter.present(ready(hideAmounts = false), generatedAt)
      as BudgetWidgetUiModel.Ready

    val tudo = listOf(
      model.title, model.paidValue, model.paidLabel, model.pendingValue,
      model.pendingLabel, model.paidDescription, model.pendingDescription,
      model.staleText ?: "",
    ).joinToString(" ")

    assertFalse(tudo.contains("user-a"))
    assertFalse(tudo.contains("ownerId"))
  }

  /* ────────────── G13–G16: a barra de progresso ────────────── */

  @Test
  fun `G13 - mes sem obrigacao nao afirma nada`() {
    /*
      Sem total positivo, barra cheia diria "tudo pago" e vazia diria "nada
      pago". As duas afirmam algo sobre um mês que não tem obrigação — omitir
      é a única leitura honesta. E não há divisão por zero.
    */
    assertNull(BudgetWidgetPresenter.progressOf(0, 0))

    val model = BudgetWidgetPresenter.present(
      ready(toPay = 0, paid = 0, pending = 0, hideAmounts = false),
      generatedAt,
    ) as BudgetWidgetUiModel.Ready

    assertNull(model.progress)
    assertEquals("R$ 0,00", model.paidValue.replace(' ', ' '))
  }

  @Test
  fun `G14 - proporcao normal`() {
    assertEquals(0.5f, BudgetWidgetPresenter.progressOf(50, 100)!!, 0.001f)
    assertEquals(
      44624f / 75724f,
      BudgetWidgetPresenter.progressOf(44624, 75724)!!,
      0.001f,
    )
  }

  @Test
  fun `G15 - pago acima do total satura em 1`() {
    assertEquals(1f, BudgetWidgetPresenter.progressOf(200, 100)!!, 0.001f)
  }

  @Test
  fun `G16 - entradas negativas nao produzem barra invalida`() {
    assertNull(BudgetWidgetPresenter.progressOf(50, -100))
    assertEquals(0f, BudgetWidgetPresenter.progressOf(-50, 100)!!, 0.001f)
  }

  /* ────────────── G17–G21: os estados de tela ────────────── */

  @Test
  fun `G17 - signedOut nao carrega mes, valor nem progresso`() {
    val model = BudgetWidgetPresenter.present(SnapshotState.SignedOut, generatedAt)

    assertTrue(model is BudgetWidgetUiModel.SignedOut)
    val out = model as BudgetWidgetUiModel.SignedOut
    assertEquals("CARTERO", out.title)
    assertEquals("Abra o Cartero para entrar", out.message)

    val tudo = out.title + " " + out.message
    assertFalse(tudo.contains("R$"))
    assertFalse(tudo.contains("SETEMBRO"))
  }

  @Test
  fun `G18 G19 G20 - ausente, corrompido e versao futura caem no estado neutro`() {
    /*
      A copy é diferente da de logout de propósito: um widget adicionado antes
      do primeiro sync cai aqui, e dizer "sessão expirada" afirmaria algo que
      não aconteceu.
    */
    val model = BudgetWidgetPresenter.present(SnapshotState.Unavailable, generatedAt)

    assertTrue(model is BudgetWidgetUiModel.Unavailable)
    val indisponivel = model as BudgetWidgetUiModel.Unavailable
    assertEquals("Abra o Cartero para atualizar", indisponivel.message)
    assertFalse(indisponivel.message.contains("expirou"))
    assertFalse(indisponivel.message.contains("sessão"))
  }

  @Test
  fun `G21 - READY desenha o orcamento`() {
    val model = BudgetWidgetPresenter.present(ready(), generatedAt)

    assertTrue(model is BudgetWidgetUiModel.Ready)
    val pronto = model as BudgetWidgetUiModel.Ready
    assertEquals("Pago", pronto.paidLabel)
    assertEquals("A pagar", pronto.pendingLabel)
    assertNotNull(pronto.progress)
  }

  /* ────────────── G22–G25: a idade do dado ────────────── */

  @Test
  fun `G22 - abaixo de 6h nao ha rotulo`() {
    val cincoHorasEMeia = generatedAt + (5 * 3_600_000L) + (59 * 60_000L)

    assertNull(BudgetWidgetPresenter.staleTextFor(generatedAt, cincoHorasEMeia))
    assertNull(BudgetWidgetPresenter.staleTextFor(generatedAt, generatedAt))
  }

  @Test
  fun `G23 - a partir de 6h o rotulo aparece`() {
    val seisHoras = generatedAt + (6 * 3_600_000L)

    assertEquals(
      "Atualizado há 6h",
      BudgetWidgetPresenter.staleTextFor(generatedAt, seisHoras),
    )
  }

  @Test
  fun `G24 - entre 6h e 24h conta em horas`() {
    val vinteETresHoras = generatedAt + (23 * 3_600_000L)

    assertEquals(
      "Atualizado há 23h",
      BudgetWidgetPresenter.staleTextFor(generatedAt, vinteETresHoras),
    )
  }

  @Test
  fun `G25 - a partir de 24h vira data`() {
    val doisDias = generatedAt + (48 * 3_600_000L)
    val texto = BudgetWidgetPresenter.staleTextFor(generatedAt, doisDias)!!

    assertTrue(texto.startsWith("Atualizado em "))
    // "há 48h" seria ilegível; a data é o formato que se lê de relance.
    assertFalse(texto.contains("h"))
  }

  @Test
  fun `relogio atrasado nao produz rotulo negativo`() {
    val antes = generatedAt - 3_600_000L

    assertNull(BudgetWidgetPresenter.staleTextFor(generatedAt, antes))
  }
}
