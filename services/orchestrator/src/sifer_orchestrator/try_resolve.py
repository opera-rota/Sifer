import argparse
import asyncio
import sys

from grpc import aio
from sifer.v1 import interaction_pb2, orchestrator_pb2, orchestrator_pb2_grpc

from sifer_orchestrator.config import Config


async def resolve(port: int, text: str, instruction: str, app: str) -> int:
    async with aio.insecure_channel(f"127.0.0.1:{port}") as channel:
        stub = orchestrator_pb2_grpc.OrchestratorServiceStub(channel)
        try:
            response = await stub.Resolve(
                orchestrator_pb2.ResolveRequest(
                    drop_context=interaction_pb2.DropContext(
                        reader=interaction_pb2.DROP_READER_ACCESSIBILITY,
                        scope=interaction_pb2.DROP_SCOPE_POINT,
                        app_key=app,
                        element_role="Paragraph",
                        content=text,
                    ),
                    instruction=interaction_pb2.Instruction(text=instruction),
                ),
                timeout=30,
            )
        except aio.AioRpcError as error:
            sys.stderr.write(f"{error.code().name}: {error.details()}\n")
            return 1
    plan = response.fix_plan
    sys.stdout.write(f"engine: {plan.engine}\nfallback: {plan.fallback}\n\n{plan.replacement}\n")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="sifer-resolve")
    parser.add_argument("text")
    parser.add_argument("--instruction", default="make this more professional")
    parser.add_argument("--app", default="microsoft.word")
    args = parser.parse_args()
    port = Config.from_env().port
    raise SystemExit(asyncio.run(resolve(port, args.text, args.instruction, args.app)))


if __name__ == "__main__":
    main()
